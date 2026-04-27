function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
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
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
  s3: {
    endpoint: requireEnv("S3_ENDPOINT"),
    bucket: requireEnv("S3_BUCKET"),
    region: process.env["S3_REGION"] ?? "auto",
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
  },
};
