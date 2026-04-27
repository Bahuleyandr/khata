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
