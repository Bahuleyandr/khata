import OpenAI from "openai";
import { config } from "../config.js";

// Single OpenRouter-backed client for every LLM call. OpenRouter exposes
// Claude, MiniMax, GPT, Gemini, DeepSeek, Llama, etc. through the OpenAI
// chat-completions wire format. Per-intent model is selected via
// `config.models.<intent>` and overridable through env vars.
//
// HTTP-Referer + X-Title are OpenRouter conventions for attribution
// (visible in the OpenRouter dashboard's per-app usage breakdown).
export const llm = new OpenAI({
  apiKey: config.openrouterApiKey,
  baseURL: "https://openrouter.ai/api/v1",
  maxRetries: 5,
  defaultHeaders: {
    "HTTP-Referer": "https://khata.bahulyean.com",
    "X-Title": "Khata",
  },
});

export const models = config.models;
