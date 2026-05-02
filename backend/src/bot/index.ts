import { Bot } from "grammy";
import { config } from "../config.js";
import { isAllowedUser } from "../middleware/auth.js";
import { resolveAccessForTelegramUser } from "../db/access.js";
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
  handleDashboard,
} from "./handlers.js";

export const bot = new Bot(config.telegramBotToken);

bot.use(async (ctx, next) => {
  const from = ctx.from;
  const userId = from?.id;
  if (!from || userId == null) {
    await ctx.reply("Unauthorized.");
    return;
  }
  if (!isAllowedUser(userId)) {
    const access = await resolveAccessForTelegramUser(userId, {
      firstName: from.first_name,
      username: from.username,
    });
    if (!access || access.status !== "active" || access.ledgerUserId === null) {
      await ctx.reply("Unauthorized. Ask the Khata owner to add your Telegram ID.");
      return;
    }
    // Existing bot handlers scope all money data to ctx.from.id.  For household
    // members, point that id at the shared ledger while replies still go to the
    // original chat.
    from.id = access.ledgerUserId;
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
bot.command("dashboard", handleDashboard);

bot.on("callback_query:data", handleCallbackQuery);
bot.on("message:text", handleTextMessage);
bot.on("message:document", handleDocument);
bot.on("message:photo", handlePhoto);
bot.on("message:voice", handleVoice);

/**
 * If MINI_APP_URL is configured, install a global chat menu button that
 * launches the Mini App. Best-effort — failures don't block bot startup
 * (Telegram occasionally rate-limits this endpoint, and the /dashboard
 * command is a perfectly fine fallback path either way).
 */
export async function installMiniAppMenuButton(): Promise<void> {
  if (!config.miniAppUrl) {
    console.log("MINI_APP_URL not set — skipping chat menu button install.");
    return;
  }
  try {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Dashboard",
        web_app: { url: config.miniAppUrl },
      },
    });
    console.log(`Chat menu button → ${config.miniAppUrl}`);
  } catch (err) {
    console.warn("Failed to set chat menu button:", err);
  }
}
