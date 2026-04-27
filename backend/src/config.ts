function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function requireEnvMinLen(key: string, minLen: number): string {
  const value = requireEnv(key);
  if (value.length < minLen) throw new Error(`${key} must be at least ${minLen} characters`);
  return value;
}

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  // Comma-separated list of allowed Telegram user IDs (numeric)
  allowedTelegramUserIds: requireEnv("ALLOWED_TELEGRAM_USER_IDS")
    .split(",")
    .map((id) => parseInt(id.trim(), 10)),
  databaseUrl: requireEnv("DATABASE_URL"),
  // MiniMax direct (api.minimax.io). One key for both the OpenAI-compat chat
  // endpoint (text intents) and the MCP server `minimax-coding-plan-mcp`
  // (vision intent via `understand_image`).
  minimaxApiKey: requireEnv("MINIMAX_API_KEY"),
  models: {
    parseExpense: process.env["MODEL_PARSE_EXPENSE"] ?? "MiniMax-M2.7-highspeed",
    classifyMessage: process.env["MODEL_CLASSIFY_MESSAGE"] ?? "MiniMax-M2.7-highspeed",
    chatWithData: process.env["MODEL_CHAT_WITH_DATA"] ?? "MiniMax-M2.7-highspeed",
    normalizeTransactions:
      process.env["MODEL_NORMALIZE_TRANSACTIONS"] ?? "MiniMax-M2.7-highspeed",
    // Vision intents go through the MCP `understand_image` tool — MiniMax
    // picks the underlying vision model. These labels exist for usage logs.
    extractTextFromImage: "minimax-mcp:understand_image",
    ocrReceiptImage: "minimax-mcp:understand_image",
  },
  sessionSecret: requireEnvMinLen("SESSION_SECRET", 32),
  // Same-origin in production (frontend + backend served behind one Tailscale
  // hostname via Traefik path routing). Local dev needs http://localhost:3000
  // for the Next.js dev server.
  allowedOrigins: (process.env["ALLOWED_ORIGINS"] ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim()),
  s3: {
    endpoint: requireEnv("S3_ENDPOINT"),
    bucket: requireEnv("S3_BUCKET"),
    region: process.env["S3_REGION"] ?? "auto",
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
  },
};
