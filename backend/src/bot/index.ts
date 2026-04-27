import { Bot, webhookCallback } from "grammy";
import { config } from "../config.js";
import { isAllowedUser } from "../middleware/auth.js";
import { handleDocument, handlePhoto, handleStart, handleTextMessage } from "./handlers.js";

export function createBot() {
  const bot = new Bot(config.telegramBotToken);

  // Reject any message from users not in the allowlist
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId == null || !isAllowedUser(userId)) {
      await ctx.reply("Unauthorized.");
      return;
    }
    await next();
  });

  bot.command("start", handleStart);
  bot.on("message:text", handleTextMessage);
  bot.on("message:document", handleDocument);
  bot.on("message:photo", handlePhoto);

  return bot;
}

export function buildWebhookHandler(secretToken: string) {
  const bot = createBot();
  return webhookCallback(bot, "fastify", {
    secretToken,
  });
}
