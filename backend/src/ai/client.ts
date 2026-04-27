import OpenAI from "openai";
import { config } from "../config.js";

// MiniMax direct over their OpenAI-compatible chat completions endpoint at
// api.minimax.io. Used for every text intent (parseExpense, classifyMessage,
// normalizeTransactions). Vision intents go through ai/mcp.ts since MiniMax's
// chat endpoint is text-only.
//
// `maxRetries: 5` covers transient 429/5xx with exponential backoff (default
// is 2, which we found insufficient under burst).
export const llm = new OpenAI({
  apiKey: config.minimaxApiKey,
  baseURL: "https://api.minimax.io/v1",
  maxRetries: 5,
});

export const models = config.models;
