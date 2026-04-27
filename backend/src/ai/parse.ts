import { config } from "../config.js";
import { llm } from "./client.js";
import { logUsage, logUsageError } from "./usage.js";
import type { CategoryOverride } from "../db/overrides.js";

export interface ParsedExpense {
  amount: number;
  currency: string;
  description: string;
  merchant: string | null;
  occurred_at: string; // YYYY-MM-DD
  category: string;
}

export interface QueryIntent {
  category?: string;
  time_range_label: string;
  start_date: string;
  end_date: string;
  group_by_category?: boolean;
  top_n?: number;
}

export type MessageClassification =
  | { type: "expense"; data: ParsedExpense }
  | { type: "query"; intent: QueryIntent }
  | { type: "clarify"; question: string }
  | { type: "unknown" };

const LOG_EXPENSE_TOOL = {
  type: "function" as const,
  function: {
    name: "log_expense",
    description: "Log a parsed expense from the user message",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount as a decimal (e.g. 45.0 or 1200.0)" },
        currency: { type: "string", description: "3-letter ISO currency code (e.g. INR, USD)" },
        description: { type: "string", description: "Short human-readable description" },
        merchant: { type: "string", description: "Merchant or vendor name if mentioned" },
        occurred_at: {
          type: "string",
          description:
            "Date in YYYY-MM-DD format. Resolve relative dates like 'yesterday' using today's date.",
        },
        category: {
          type: "string",
          description: "Category from the available list that best fits this expense",
        },
      },
      required: ["amount", "currency", "description", "occurred_at", "category"],
    },
  },
};

const QUERY_SPEND_TOOL = {
  type: "function" as const,
  function: {
    name: "query_spend",
    description: "Retrieve spending data when the user asks a question about their expenses",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category to filter by (omit for all)" },
        time_range_label: {
          type: "string",
          description: "Human-readable label (e.g. 'this month', 'last week', 'this year')",
        },
        start_date: {
          type: "string",
          description: "Start of range YYYY-MM-DD (inclusive), computed from today",
        },
        end_date: {
          type: "string",
          description: "End of range YYYY-MM-DD (inclusive), computed from today",
        },
        group_by_category: {
          type: "boolean",
          description: "True to show a breakdown by category",
        },
        top_n: {
          type: "integer",
          description: "If set, return the N largest individual expenses",
        },
      },
      required: ["time_range_label", "start_date", "end_date"],
    },
  },
};

const REQUEST_CLARIFICATION_TOOL = {
  type: "function" as const,
  function: {
    name: "request_clarification",
    description: "Ask the user to clarify a spending query when details are ambiguous",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The clarification question to ask" },
      },
      required: ["question"],
    },
  },
};

function buildOverrideContext(overrides: CategoryOverride[]): string {
  if (overrides.length === 0) return "";
  return (
    "\n\nUser correction history (prefer these category mappings):\n" +
    overrides.map((o) => `- "${o.hint_text}" → ${o.category_name}`).join("\n")
  );
}

function expenseDataFromInput(
  input: Record<string, unknown>,
  categories: string[],
  today: string,
): ParsedExpense {
  return {
    amount: Number(input["amount"]),
    currency: String(input["currency"] ?? "INR").toUpperCase(),
    description: String(input["description"] ?? ""),
    merchant: input["merchant"] != null ? String(input["merchant"]) : null,
    occurred_at: String(input["occurred_at"] ?? today),
    category: String(
      input["category"] ?? categories[categories.length - 1] ?? "Other",
    ),
  };
}

export async function parseExpense(
  text: string,
  categories: string[],
  overrides: CategoryOverride[],
  today: string,
): Promise<ParsedExpense | null> {
  const systemPrompt =
    `You are an expense parsing assistant. Extract expense details from user messages.\n` +
    `Available categories: ${categories.join(", ")}.\n` +
    `Today's date: ${today}.\n` +
    `Default currency: INR.\n` +
    `If the message is clearly not an expense description, do not call any tool.` +
    buildOverrideContext(overrides);

  const model = config.models.parseExpense;
  const start = Date.now();
  let response;
  try {
    response = await llm.chat.completions.create({
      model,
      max_tokens: 256,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      tools: [LOG_EXPENSE_TOOL],
      tool_choice: "auto",
    });
  } catch (err) {
    logUsageError("parseExpense", model, err, Date.now() - start);
    throw err;
  }
  logUsage("parseExpense", model, response, Date.now() - start);

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return null;

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return null;
  }

  return expenseDataFromInput(input, categories, today);
}

export async function classifyMessage(
  text: string,
  categories: string[],
  overrides: CategoryOverride[],
  today: string,
): Promise<MessageClassification> {
  const systemPrompt =
    `You are an expense tracking assistant. Classify the user message:\n` +
    `1. New expense entry → call log_expense\n` +
    `2. Question about spending → call query_spend\n` +
    `3. Ambiguous spending question (missing details) → call request_clarification\n` +
    `4. Unrelated message → call no tool\n\n` +
    `Available categories: ${categories.join(", ")}.\n` +
    `Today's date: ${today}.\n` +
    `Default currency: INR.` +
    buildOverrideContext(overrides);

  const model = config.models.classifyMessage;
  const start = Date.now();
  let response;
  try {
    response = await llm.chat.completions.create({
      model,
      max_tokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      tools: [LOG_EXPENSE_TOOL, QUERY_SPEND_TOOL, REQUEST_CLARIFICATION_TOOL],
      tool_choice: "auto",
    });
  } catch (err) {
    logUsageError("classifyMessage", model, err, Date.now() - start);
    throw err;
  }
  logUsage("classifyMessage", model, response, Date.now() - start);

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return { type: "unknown" };

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return { type: "unknown" };
  }

  if (toolCall.function.name === "log_expense") {
    return { type: "expense", data: expenseDataFromInput(input, categories, today) };
  }

  if (toolCall.function.name === "query_spend") {
    return {
      type: "query",
      intent: {
        category: input["category"] != null ? String(input["category"]) : undefined,
        time_range_label: String(input["time_range_label"]),
        start_date: String(input["start_date"]),
        end_date: String(input["end_date"]),
        group_by_category: input["group_by_category"] === true,
        top_n: input["top_n"] != null ? Number(input["top_n"]) : undefined,
      },
    };
  }

  if (toolCall.function.name === "request_clarification") {
    return {
      type: "clarify",
      question: String(input["question"] ?? "Could you clarify what you mean?"),
    };
  }

  return { type: "unknown" };
}
