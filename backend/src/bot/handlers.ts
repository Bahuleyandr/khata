import { Buffer } from "node:buffer";
import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { uploadStatement } from "../storage/index.js";
import { sql } from "../db/index.js";
import { parseStatementBuffer } from "../statement/parser.js";
import { dedupeTransactions } from "../statement/dedup.js";
import {
  clearPendingImport,
  getPendingImport,
  setPendingImport,
} from "../statement/session.js";
import {
  bulkInsertTransactions,
  createStatementRecord,
  updateStatementStatus,
} from "../statement/importer.js";
import { config } from "../config.js";
import {
  seedDefaultCategories,
  getUserCategories,
  getCategoryByName,
  renameCategory,
  addCategory,
  deleteCategory,
} from "../db/categories.js";
import {
  insertExpense,
  updateExpenseAmount,
  updateExpenseCategory,
  updateExpenseDate,
} from "../db/expenses.js";
import { getOverrides, upsertOverride } from "../db/overrides.js";
import { parseExpense } from "../ai/parse.js";
import { pendingEdits } from "./session.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().split("T")[0]!;
}

function formatAmount(amount_cents: number, currency: string): string {
  const amount = amount_cents / 100;
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency + " ";
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function editKeyboard(expenseId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Change Category", `editcat:${expenseId}`)
    .text("Edit Amount", `editamt:${expenseId}`)
    .text("Edit Date", `editdt:${expenseId}`);
}

async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const fileResp = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/getFile?file_id=${fileId}`,
  );
  if (!fileResp.ok) throw new Error(`getFile failed: ${fileResp.status}`);
  const fileJson = (await fileResp.json()) as { result: { file_path: string } };
  const filePath = fileJson.result.file_path;

  const dlResp = await fetch(
    `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`,
  );
  if (!dlResp.ok) throw new Error(`File download failed: ${dlResp.status}`);

  const arrayBuffer = await dlResp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = dlResp.headers.get("content-type") ?? "application/octet-stream";
  return { buffer, mimeType };
}

async function runStatementPipeline(
  ctx: Context,
  fileId: string,
  mimeType: string,
  fileName: string,
): Promise<void> {
  const userId = ctx.from!.id;
  const chatId = ctx.chat!.id;

  await ctx.reply(`⏳ Downloading ${fileName}…`);

  let buffer: Buffer;
  try {
    ({ buffer } = await downloadTelegramFile(fileId));
  } catch (err) {
    await ctx.reply(`❌ Could not download the file: ${String(err)}`);
    return;
  }

  const statementId = await createStatementRecord(userId, "");
  const s3Key = `statements/${userId}/${statementId}`;
  try {
    await uploadStatement(s3Key, buffer, mimeType);
    await sql`UPDATE statements SET file_key = ${s3Key} WHERE id = ${statementId}`;
  } catch (err) {
    await updateStatementStatus(statementId, "failed", undefined, String(err));
    await ctx.reply(`❌ Upload failed: ${String(err)}`);
    return;
  }

  await ctx.reply("📤 Uploaded. Parsing transactions…");

  let transactions;
  try {
    transactions = await parseStatementBuffer(buffer, mimeType);
  } catch (err) {
    await updateStatementStatus(statementId, "failed", undefined, String(err));
    await ctx.reply(`❌ Parsing failed: ${String(err)}`);
    return;
  }

  if (transactions.length === 0) {
    await updateStatementStatus(statementId, "failed", 0, "No transactions found");
    await ctx.reply("⚠️ No transactions found in the statement.");
    return;
  }

  await updateStatementStatus(statementId, "parsed", transactions.length);

  const results = await dedupeTransactions(userId, transactions);
  const alreadyLoggedCount = results.filter((r) => r.alreadyLogged).length;
  const newCount = results.length - alreadyLoggedCount;

  setPendingImport(chatId, {
    statementId,
    results,
    totalCount: results.length,
    alreadyLoggedCount,
    newCount,
  });

  await ctx.reply(
    `📊 Found *${results.length}* transactions — *${alreadyLoggedCount}* already logged, *${newCount}* new.\n\nImport the remaining ${newCount}? Reply *yes* to import or *no* to cancel.`,
    { parse_mode: "Markdown" },
  );
}

// ── Start / Help ─────────────────────────────────────────────────────────────

export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (userId) await seedDefaultCategories(userId).catch(console.error);
  await ctx.reply(
    "👋 Hello! I'm your expense tracker bot.\n\n" +
      "Log an expense by typing, e.g.:\n" +
      '• "$45 lunch"\n' +
      '• "paid 1200 inr for uber yesterday"\n\n' +
      "Or upload a bank statement PDF/photo and I'll parse it automatically.\n\n" +
      "Commands:\n" +
      "/categories — list your categories\n" +
      "/add <name> — add a category\n" +
      "/rename <old> <new> — rename a category\n" +
      "/delete <name> — delete a category\n" +
      "/help — show this message",
  );
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    "📊 *Expense Tracker Help*\n\n" +
      "*Log an expense:* Just type it, e.g.:\n" +
      "• `$45 lunch`\n" +
      "• `paid 1200 inr for uber yesterday`\n\n" +
      "*After logging:* Tap the edit buttons or type `edit` to change details.\n\n" +
      "*Statement import:* Upload a PDF or image — I'll extract and dedupe transactions.\n\n" +
      "*Commands:*\n" +
      "/categories — list your categories\n" +
      "/add <name> — add a category\n" +
      "/rename <old> <new> — rename a category\n" +
      "/delete <name> — delete a category",
    { parse_mode: "Markdown" },
  );
}

// ── Category commands ─────────────────────────────────────────────────────────

export async function handleCategories(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const cats = await getUserCategories(userId);
  const list = cats.map((c) => `• ${c.name}`).join("\n");
  await ctx.reply(`📋 Your categories:\n${list}`);
}

export async function handleAddCategory(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message?.text ?? "";
  const name = text.replace(/^\/add\s*/i, "").trim();
  if (!name) {
    await ctx.reply("Usage: /add <category name>");
    return;
  }
  const ok = await addCategory(userId, name);
  await ctx.reply(ok ? `✅ Added category "${name}"` : `⚠️ Category "${name}" already exists`);
}

export async function handleRenameCategory(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message?.text ?? "";
  const parts = text.replace(/^\/rename\s*/i, "").trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Usage: /rename <old name> <new name>");
    return;
  }
  const [oldName, ...rest] = parts;
  const newName = rest.join(" ");
  const ok = await renameCategory(userId, oldName!, newName);
  await ctx.reply(
    ok ? `✅ Renamed "${oldName}" → "${newName}"` : `⚠️ Category "${oldName}" not found`,
  );
}

export async function handleDeleteCategory(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const text = ctx.message?.text ?? "";
  const name = text.replace(/^\/delete\s*/i, "").trim();
  if (!name) {
    await ctx.reply("Usage: /delete <category name>");
    return;
  }
  const ok = await deleteCategory(userId, name);
  await ctx.reply(
    ok
      ? `✅ Deleted category "${name}"`
      : `⚠️ "${name}" not found or is a built-in category (cannot delete defaults)`,
  );
}

// ── Text message handler ──────────────────────────────────────────────────────

export async function handleTextMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message?.text?.trim();
  if (!userId || !text) return;

  // Skip commands — registered separately on the bot
  if (text.startsWith("/")) return;

  const chatId = ctx.chat?.id;
  const pendingEdit = pendingEdits.get(userId);

  // "edit" shortcut — re-show edit keyboard for last logged expense
  if (text.toLowerCase() === "edit") {
    if (!pendingEdit) {
      await ctx.reply("Nothing to edit yet. Log an expense first.");
      return;
    }
    await ctx.reply(
      `Editing: ${formatAmount(pendingEdit.amount_cents, pendingEdit.currency)} ${pendingEdit.description} — ${pendingEdit.category}`,
      { reply_markup: editKeyboard(pendingEdit.expenseId) },
    );
    return;
  }

  // Handle follow-up input for an active edit
  if (pendingEdit?.waitingFor === "amount") {
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]{3})?$/);
    if (!match) {
      await ctx.reply("Please enter the amount (e.g. `200` or `200 USD`):");
      return;
    }
    const amount_cents = Math.round(parseFloat(match[1]!) * 100);
    const currency = match[2]?.toUpperCase() ?? pendingEdit.currency;
    const ok = await updateExpenseAmount(pendingEdit.expenseId, userId, amount_cents, currency);
    if (ok) {
      pendingEdit.amount_cents = amount_cents;
      pendingEdit.currency = currency;
      pendingEdit.waitingFor = undefined;
    }
    await ctx.reply(
      ok ? `✅ Updated to ${formatAmount(amount_cents, currency)}` : "⚠️ Failed to update amount",
    );
    return;
  }

  if (pendingEdit?.waitingFor === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      await ctx.reply("Please enter the date in YYYY-MM-DD format (e.g. `2026-04-26`):");
      return;
    }
    const occurred_at = new Date(text + "T12:00:00Z");
    const ok = await updateExpenseDate(pendingEdit.expenseId, userId, occurred_at);
    if (ok) {
      pendingEdit.occurred_at = occurred_at;
      pendingEdit.waitingFor = undefined;
    }
    await ctx.reply(ok ? `✅ Date updated to ${text}` : "⚠️ Failed to update date");
    return;
  }

  // Check for a pending statement import confirmation
  if (chatId) {
    const pendingImport = getPendingImport(chatId);
    if (pendingImport) {
      const lower = text.toLowerCase();
      if (lower === "yes" || lower === "y") {
        await ctx.reply("⏳ Importing…");
        try {
          const inserted = await bulkInsertTransactions(
            userId,
            pendingImport.statementId,
            pendingImport.results,
          );
          await updateStatementStatus(
            pendingImport.statementId,
            "imported",
            pendingImport.totalCount,
          );
          clearPendingImport(chatId);
          await ctx.reply(
            `✅ Imported ${inserted} new transaction${inserted !== 1 ? "s" : ""}.`,
          );
        } catch (err) {
          await updateStatementStatus(
            pendingImport.statementId,
            "failed",
            undefined,
            String(err),
          );
          clearPendingImport(chatId);
          await ctx.reply(`❌ Import failed: ${String(err)}`);
        }
      } else if (lower === "no" || lower === "n") {
        clearPendingImport(chatId);
        await ctx.reply("Import cancelled.");
      } else {
        await ctx.reply("Reply *yes* to import or *no* to cancel.", { parse_mode: "Markdown" });
      }
      return;
    }
  }

  // Parse as new expense
  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides] = await Promise.all([getUserCategories(userId), getOverrides(userId)]);

  let parsed;
  try {
    parsed = await parseExpense(text, cats.map((c) => c.name), overrides, todayString());
  } catch (err) {
    console.error("AI parse error:", err);
    await ctx.reply("⚠️ I had trouble parsing that. Try: `$45 lunch` or `paid 1200 for uber`");
    return;
  }

  if (!parsed) {
    await ctx.reply(
      "🤔 That doesn't look like an expense. Try: `$45 lunch` or `paid 1200 for uber`",
    );
    return;
  }

  const cat =
    cats.find((c) => c.name.toLowerCase() === parsed!.category.toLowerCase()) ??
    cats.find((c) => c.name === "Other") ??
    null;

  const amount_cents = Math.round(parsed.amount * 100);
  const occurred_at = new Date(parsed.occurred_at + "T12:00:00Z");

  const expenseId = await insertExpense({
    userId,
    amount_cents,
    currency: parsed.currency,
    description: parsed.description,
    merchant: parsed.merchant,
    category_id: cat?.id ?? null,
    occurred_at,
    source: "telegram",
    raw_text: text,
  });

  pendingEdits.set(userId, {
    expenseId,
    amount_cents,
    currency: parsed.currency,
    category: cat?.name ?? "Other",
    description: parsed.description,
    occurred_at,
  });

  await ctx.reply(
    `Logged: ${formatAmount(amount_cents, parsed.currency)} ${parsed.description} — ${cat?.name ?? "Other"}. Reply edit to change.`,
    { reply_markup: editKeyboard(expenseId) },
  );
}

// ── Callback query handler ────────────────────────────────────────────────────

export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const data = (ctx.callbackQuery as { data?: string } | undefined)?.data;
  if (!userId || !data) {
    await ctx.answerCallbackQuery();
    return;
  }

  const pending = pendingEdits.get(userId);

  if (data.startsWith("editcat:")) {
    const expenseId = data.slice(8);
    if (pending) pending.expenseId = expenseId;
    const cats = await getUserCategories(userId);
    const keyboard = new InlineKeyboard();
    cats.forEach((c, i) => {
      keyboard.text(c.name, `sc:${c.name}`);
      if ((i + 1) % 3 === 0) keyboard.row();
    });
    await ctx.answerCallbackQuery();
    await ctx.reply("Select new category:", { reply_markup: keyboard });
    return;
  }

  if (data.startsWith("sc:")) {
    const catName = data.slice(3);
    if (!pending) {
      await ctx.answerCallbackQuery("Session expired — log an expense first");
      return;
    }
    const cat = await getCategoryByName(userId, catName);
    if (!cat) {
      await ctx.answerCallbackQuery("Category not found");
      return;
    }
    const ok = await updateExpenseCategory(pending.expenseId, userId, cat.id);
    if (ok) {
      if (pending.description && cat.name !== pending.category) {
        await upsertOverride(userId, pending.description.toLowerCase(), cat.name).catch(
          console.error,
        );
      }
      pending.category = cat.name;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(ok ? `✅ Category updated to "${cat.name}"` : "⚠️ Failed to update category");
    return;
  }

  if (data.startsWith("editamt:")) {
    if (pending) pending.waitingFor = "amount";
    await ctx.answerCallbackQuery();
    await ctx.reply("Enter new amount (e.g. `200` or `200 USD`):");
    return;
  }

  if (data.startsWith("editdt:")) {
    if (pending) pending.waitingFor = "date";
    await ctx.answerCallbackQuery();
    await ctx.reply("Enter new date (YYYY-MM-DD, e.g. `2026-04-26`):");
    return;
  }

  await ctx.answerCallbackQuery();
}

// ── Document / Photo ──────────────────────────────────────────────────────────

export async function handleDocument(ctx: Context): Promise<void> {
  const doc = ctx.message?.document;
  if (!doc) {
    await ctx.reply("📄 Document received but I couldn't read it.");
    return;
  }

  const mimeType = doc.mime_type ?? "application/octet-stream";
  const supported = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!supported.includes(mimeType)) {
    await ctx.reply(`⚠️ Unsupported file type: ${mimeType}. Send a PDF or image.`);
    return;
  }

  await runStatementPipeline(ctx, doc.file_id, mimeType, doc.file_name ?? "document");
}

export async function handlePhoto(ctx: Context): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply("📷 Photo received but I couldn't read it.");
    return;
  }

  const photo = photos[photos.length - 1]!;
  await runStatementPipeline(ctx, photo.file_id, "image/jpeg", "photo.jpg");
}
