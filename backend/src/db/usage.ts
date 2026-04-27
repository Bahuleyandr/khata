import { sql } from "./index.js";

export type ClaudeIntent =
  | "parseExpense"
  | "classifyMessage"
  | "normalizeTransactions"
  | "receiptOCR";

export interface ClaudeUsageData {
  intent: ClaudeIntent;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  model: string;
}

export async function insertClaudeUsage(data: ClaudeUsageData): Promise<void> {
  await sql`
    INSERT INTO claude_usage
      (intent, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model)
    VALUES
      (${data.intent}, ${data.input_tokens}, ${data.output_tokens},
       ${data.cache_read_tokens}, ${data.cache_creation_tokens}, ${data.model})
  `;
}
