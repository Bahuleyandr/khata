import { Bot } from "grammy";
import { config } from "../config.js";
import { isAllowedUser } from "../middleware/auth.js";
import {
  handleStart,
  handleHelp,
  handleCategories,
  handleAddCategory,
  handleRenameCategory,
  handleDeleteCategory,
  handleListExpenses,
  handleListTags,
  handleAsk,
  handleBudget,
  handleTextMessage,
  handleCallbackQuery,
  handleDocument,
  handlePhoto,
  handleVoice,
  handleExport,
} from "./handlers.js";

export const bot = new Bot(config.telegramBotToken);

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId == null || !isAllowedUser(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }
  await next();
});

bot.command("start", handleStart);
bot.command("help", handleHelp);
bot.command("categories", handleCategories);
bot.command("add", handleAddCategory);
bot.command("rename", handleRenameCategory);
bot.command("delete", handleDeleteCategory);
bot.command("expenses", handleListExpenses);
bot.command("tags", handleListTags);
bot.command("ask", handleAsk);
bot.command("budget", handleBudget);
bot.command("export", handleExport);

bot.on("callback_query:data", handleCallbackQuery);
bot.on("message:text", handleTextMessage);
bot.on("message:document", handleDocument);
bot.on("message:photo", handlePhoto);
bot.on("message:voice", handleVoice);
