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
  telegramWebhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  // Comma-separated list of allowed Telegram user IDs (numeric)
  allowedTelegramUserIds: requireEnv("ALLOWED_TELEGRAM_USER_IDS")
    .split(",")
    .map((id) => parseInt(id.trim(), 10)),
  databaseUrl: requireEnv("DATABASE_URL"),
  openrouterApiKey: requireEnv("OPENROUTER_API_KEY"),
  // Per-intent model selection (OpenRouter model IDs). Defaults: Haiku 4.5
  // for the hot text path, Sonnet 4.6 for vision and statement normalization.
  // Override any of these per-deployment to swap providers (e.g. minimax/m1,
  // openai/gpt-4o-mini) without code changes.
  models: {
    parseExpense: process.env["MODEL_PARSE_EXPENSE"] ?? "anthropic/claude-haiku-4-5",
    classifyMessage: process.env["MODEL_CLASSIFY_MESSAGE"] ?? "anthropic/claude-haiku-4-5",
    normalizeTransactions:
      process.env["MODEL_NORMALIZE_TRANSACTIONS"] ?? "anthropic/claude-sonnet-4-6",
    extractTextFromImage:
      process.env["MODEL_EXTRACT_TEXT_FROM_IMAGE"] ?? "anthropic/claude-sonnet-4-6",
    ocrReceiptImage:
      process.env["MODEL_OCR_RECEIPT_IMAGE"] ?? "anthropic/claude-sonnet-4-6",
  },
  sessionSecret: requireEnvMinLen("SESSION_SECRET", 32),
  allowedOrigins: (process.env["ALLOWED_ORIGINS"] ?? "https://bahuleyan.com,http://localhost:3000")
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
