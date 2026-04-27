import Anthropic from "@anthropic-ai/sdk";
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

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function parseExpense(
  text: string,
  categories: string[],
  overrides: CategoryOverride[],
  today: string,
): Promise<ParsedExpense | null> {
  let overrideContext = "";
  if (overrides.length > 0) {
    overrideContext =
      "\n\nUser correction history (prefer these category mappings):\n" +
      overrides.map((o) => `- "${o.hint_text}" → ${o.category_name}`).join("\n");
  }

  const systemPrompt =
    `You are an expense parsing assistant. Extract expense details from user messages.\n` +
    `Available categories: ${categories.join(", ")}.\n` +
    `Today's date: ${today}.\n` +
    `Default currency: INR.\n` +
    `If the message is clearly not an expense description, do not call any tool.` +
    overrideContext;

  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: systemPrompt,
    tools: [
      {
        name: "log_expense",
        description: "Log a parsed expense from the user message",
        input_schema: {
          type: "object" as const,
          properties: {
            amount: {
              type: "number",
              description: "Amount as a decimal number (e.g. 45.0 or 1200.0)",
            },
            currency: {
              type: "string",
              description: "3-letter ISO currency code (e.g. INR, USD)",
            },
            description: {
              type: "string",
              description: "Short human-readable description of the expense",
            },
            merchant: {
              type: "string",
              description: "Merchant or vendor name if mentioned, otherwise omit",
            },
            occurred_at: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Resolve relative dates like 'yesterday' using today's date.",
            },
            category: {
              type: "string",
              description: "Category from the available list that best fits this expense",
            },
          },
          required: ["amount", "currency", "description", "occurred_at", "category"],
        },
      },
    ],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: text }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;

  const input = toolUse.input as Record<string, unknown>;
  return {
    amount: Number(input["amount"]),
    currency: String(input["currency"] ?? "INR").toUpperCase(),
    description: String(input["description"] ?? ""),
    merchant: input["merchant"] != null ? String(input["merchant"]) : null,
    occurred_at: String(input["occurred_at"] ?? today),
    category: String(input["category"] ?? categories[categories.length - 1] ?? "Other"),
  };
}

export async function classifyMessage(
  text: string,
  categories: string[],
  overrides: CategoryOverride[],
  today: string,
): Promise<MessageClassification> {
  let overrideContext = "";
  if (overrides.length > 0) {
    overrideContext =
      "\n\nUser correction history (prefer these category mappings):\n" +
      overrides.map((o) => `- "${o.hint_text}" → ${o.category_name}`).join("\n");
  }

  const systemPrompt =
    `You are an expense tracking assistant. Classify the user message:\n` +
    `1. New expense entry → call log_expense\n` +
    `2. Question about spending → call query_spend\n` +
    `3. Ambiguous spending question (missing details) → call request_clarification\n` +
    `4. Unrelated message → call no tool\n\n` +
    `Available categories: ${categories.join(", ")}.\n` +
    `Today's date: ${today}.\n` +
    `Default currency: INR.` +
    overrideContext;

  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: systemPrompt,
    tools: [
      {
        name: "log_expense",
        description: "Log a new expense from the user message",
        input_schema: {
          type: "object" as const,
          properties: {
            amount: { type: "number", description: "Amount as decimal (e.g. 45.0)" },
            currency: { type: "string", description: "3-letter ISO currency code" },
            description: { type: "string", description: "Short description" },
            merchant: { type: "string", description: "Merchant name if mentioned" },
            occurred_at: { type: "string", description: "Date YYYY-MM-DD" },
            category: { type: "string", description: "Category from available list" },
          },
          required: ["amount", "currency", "description", "occurred_at", "category"],
        },
      },
      {
        name: "query_spend",
        description: "Retrieve spending data when the user asks a question about their expenses",
        input_schema: {
          type: "object" as const,
          properties: {
            category: {
              type: "string",
              description: "Category to filter by (from available list), omit for all",
            },
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
      {
        name: "request_clarification",
        description: "Ask the user to clarify a spending query when details are ambiguous",
        input_schema: {
          type: "object" as const,
          properties: {
            question: { type: "string", description: "The clarification question to ask" },
          },
          required: ["question"],
        },
      },
    ],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: text }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { type: "unknown" };

  const input = toolUse.input as Record<string, unknown>;

  if (toolUse.name === "log_expense") {
    return {
      type: "expense",
      data: {
        amount: Number(input["amount"]),
        currency: String(input["currency"] ?? "INR").toUpperCase(),
        description: String(input["description"] ?? ""),
        merchant: input["merchant"] != null ? String(input["merchant"]) : null,
        occurred_at: String(input["occurred_at"] ?? today),
        category: String(input["category"] ?? categories[categories.length - 1] ?? "Other"),
      },
    };
  }

  if (toolUse.name === "query_spend") {
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

  if (toolUse.name === "request_clarification") {
    return {
      type: "clarify",
      question: String(input["question"] ?? "Could you clarify what you mean?"),
    };
  }

  return { type: "unknown" };
}
