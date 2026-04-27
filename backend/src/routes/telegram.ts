import type { FastifyInstance } from "fastify";
import { buildWebhookHandler } from "../bot/index.js";
import { config } from "../config.js";

export async function telegramRoutes(app: FastifyInstance) {
  const webhookHandler = buildWebhookHandler(config.telegramWebhookSecret);

  app.post("/telegram/webhook", webhookHandler);
}
