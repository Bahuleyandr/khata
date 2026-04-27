import { config } from "../config.js";
import { llm } from "./client.js";
import { withHttpUsage } from "./usage.js";
import {
  findExpensesAtMerchant,
  findRecurring,
  spendByCategory,
  topExpenses,
  totalSpendInCategory,
} from "../db/query.js";
import { getUserCategories } from "../db/categories.js";
import { listTagsWithCounts } from "../db/tags.js";

/**
 * Multi-turn LLM agent that answers freeform questions about the user's
 * expenses by calling typed query tools. The LLM picks the right tool(s),
 * we execute them, feed results back, and let the LLM compose a final reply.
 *
 * Hard cap on tool-call iterations to avoid runaway loops.
 */
const MAX_ITERATIONS = 6;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_total_spend",
      description:
        "Total spend in a date range, optionally filtered by category. Returns one row per currency.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "YYYY-MM-DD inclusive" },
          end_date: { type: "string", description: "YYYY-MM-DD inclusive" },
          category: {
            type: "string",
            description:
              "Optional category name to filter by. Omit for all categories.",
          },
        },
        required: ["start_date", "end_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_spend_by_category",
      description: "Per-category spend totals for a date range, sorted highest first.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string" },
          end_date: { type: "string" },
        },
        required: ["start_date", "end_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_top_expenses",
      description: "Largest individual expenses in a date range.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string" },
          end_date: { type: "string" },
          limit: { type: "integer", description: "Max rows to return (default 5)" },
        },
        required: ["start_date", "end_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_recurring",
      description:
        "Detect recurring expenses (merchants charged >= min_occurrences times in the last N months). Use to find subscriptions.",
      parameters: {
        type: "object",
        properties: {
          lookback_months: { type: "integer", description: "How many months back (e.g. 6)" },
          min_occurrences: {
            type: "integer",
            description: "Minimum charges to be considered recurring (e.g. 3)",
          },
        },
        required: ["lookback_months", "min_occurrences"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_expenses_at_merchant",
      description:
        "Search expenses where the merchant name contains the given substring (case-insensitive). Use this when the user asks about a specific store/merchant.",
      parameters: {
        type: "object",
        properties: {
          merchant_substring: { type: "string", description: "e.g. 'zomato', 'uber'" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          limit: { type: "integer", description: "Max rows (default 20)" },
        },
        required: ["merchant_substring", "start_date", "end_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_categories",
      description: "List all categories the user has set up. No args.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tags",
      description: "List all tags the user has set up with usage counts. No args.",
      parameters: { type: "object", properties: {} },
    },
  },
];

type ToolArgs = Record<string, unknown>;

async function executeTool(
  name: string,
  argsJson: string,
  userId: number,
): Promise<unknown> {
  let args: ToolArgs = {};
  try {
    args = JSON.parse(argsJson) as ToolArgs;
  } catch {
    return { error: `Invalid JSON arguments: ${argsJson}` };
  }

  switch (name) {
    case "get_total_spend": {
      const start = String(args["start_date"]);
      const end = String(args["end_date"]);
      const category = args["category"] != null ? String(args["category"]) : undefined;
      return totalSpendInCategory(userId, category, start, end);
    }
    case "get_spend_by_category": {
      return spendByCategory(userId, String(args["start_date"]), String(args["end_date"]));
    }
    case "get_top_expenses": {
      const limit = Math.max(1, Math.min(50, Number(args["limit"] ?? 5)));
      return topExpenses(
        userId,
        String(args["start_date"]),
        String(args["end_date"]),
        limit,
      );
    }
    case "find_recurring": {
      const lookback = Math.max(1, Math.min(36, Number(args["lookback_months"] ?? 6)));
      const minOcc = Math.max(2, Math.min(50, Number(args["min_occurrences"] ?? 3)));
      return findRecurring(userId, lookback, minOcc);
    }
    case "find_expenses_at_merchant": {
      const limit = Math.max(1, Math.min(100, Number(args["limit"] ?? 20)));
      return findExpensesAtMerchant(
        userId,
        String(args["merchant_substring"]),
        String(args["start_date"]),
        String(args["end_date"]),
        limit,
      );
    }
    case "list_categories": {
      const cats = await getUserCategories(userId);
      return cats.map((c) => c.name);
    }
    case "list_tags": {
      return listTagsWithCounts(userId);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export interface ChatResult {
  text: string;
  toolsUsed: string[];
  iterations: number;
}

export async function chatWithData(
  question: string,
  userId: number,
  today: string,
): Promise<ChatResult> {
  const systemPrompt =
    `You are a helpful personal-finance assistant. Answer the user's question about their own expenses by calling the available query tools and then summarizing the results in plain text.\n\n` +
    `Rules:\n` +
    `- Today's date is ${today}. Resolve relative ranges ("this month", "last week", "Q1") yourself.\n` +
    `- Default currency: INR. Format amounts as ₹ followed by the integer part with thousands-separators (e.g. ₹12,340).\n` +
    `- Be concise. 1–4 short sentences in the final answer, plus an optional bullet list when listing items.\n` +
    `- If the data shows nothing relevant, say so honestly. Don't invent transactions.\n` +
    `- For comparisons, call the tool twice with different date ranges and compute the diff yourself.\n` +
    `- For "subscriptions" / "recurring" questions, use find_recurring with lookback_months=6 and min_occurrences=3 unless the user specifies otherwise.\n` +
    `- Use Markdown for formatting (bold, italic, bullets). Keep it lightweight.`;

  // OpenAI chat-completions message types are slightly involved; using the
  // SDK's own array-of-messages typing is simplest.
  const messages: Parameters<typeof llm.chat.completions.create>[0]["messages"] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ];

  const toolsUsed: string[] = [];
  const model = config.models.chatWithData;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await withHttpUsage("chatWithData", model, () =>
      llm.chat.completions.create({
        model,
        max_tokens: 1024,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    );

    const message = response.choices[0]?.message;
    if (!message) {
      return { text: "I didn't get a response from the model.", toolsUsed, iterations: i + 1 };
    }

    // Echo the assistant message back so the next turn includes it
    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        text: message.content ?? "(no answer)",
        toolsUsed,
        iterations: i + 1,
      };
    }

    // Execute each tool call and append the result as a `tool` message
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      toolsUsed.push(call.function.name);
      let result: unknown;
      try {
        result = await executeTool(call.function.name, call.function.arguments, userId);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    text:
      "I couldn't reach a conclusion within the iteration limit. Try asking a more specific question.",
    toolsUsed,
    iterations: MAX_ITERATIONS,
  };
}
