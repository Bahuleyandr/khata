import { Bot } from "grammy";
import { config } from "../config.js";
import { isAllowedUser } from "../middleware/auth.js";
import {
  listLedgersForTelegramUser,
  resolveAccessForTelegramUser,
  resolveLedgerForTelegramUser,
} from "../db/access.js";
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
  }

  const text = ctx.message && "text" in ctx.message ? ctx.message.text : undefined;
  const sharedMatch = text?.match(/^\s*(?:shared|household)\s+(.+)/i);
  if (sharedMatch) {
    const householdLedger = (await listLedgersForTelegramUser(userId)).find(
      (ledger) => ledger.ledgerKind === "household" && ledger.canAdd,
    );
    if (!householdLedger) {
      await ctx.reply("You do not have write access to a household ledger yet.");
      return;
    }
    const householdAccess = await resolveLedgerForTelegramUser({
      telegramUserId: userId,
      requestedLedgerId: householdLedger.ledgerId,
      requireWrite: true,
    });
    if (!householdAccess) {
      await ctx.reply("You do not have write access to a household ledger yet.");
      return;
    }
    from.id = householdAccess.ledgerId;
    ctx.message!.text = sharedMatch[1]!.trim();
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
