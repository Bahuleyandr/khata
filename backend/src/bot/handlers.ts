import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import { uploadStatement } from "../storage/index.js";
import { buildMonthlyXlsx, currentMonthBounds } from "../export/xlsx.js";
import { sql } from "../db/index.js";
import { parseStatementBuffer } from "../statement/parser.js";
import { dedupeTransactions } from "../statement/dedup.js";
import { redactError } from "../statement/redact.js";
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
import { setBudget, listBudgets, clearBudget } from "../db/budgets.js";
import {
  insertExpense,
  updateExpenseAmount,
  updateExpenseCategory,
  updateExpenseDate,
  findExpenseByContentHash,
} from "../db/expenses.js";
import { getOverrides, upsertOverride } from "../db/overrides.js";
import {
  attachTagToExpense,
  detachTagFromExpense,
  findTagByName,
  getOrCreateTag,
  getTagsForExpenses,
  listTagsWithCounts,
} from "../db/tags.js";
import { parseExpense, classifyMessage, type QueryIntent } from "../ai/parse.js";
import { chatWithData } from "../ai/chat.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { tryParseUpi, type UpiParse } from "../upi/parse.js";
import { totalSpendInCategory, topExpenses, spendByCategory } from "../db/query.js";
import { ocrReceiptImage } from "../receipt/ocr.js";
import { getPendingEdit, setPendingEdit } from "./session.js";

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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function rejectIfOversize(ctx: Context, buffer: Buffer): Promise<boolean> {
  if (buffer.length <= MAX_UPLOAD_BYTES) return false;
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  const limitMB = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
  await ctx.reply(`⚠️ File too large (${sizeMB}MB; max ${limitMB}MB). Please send a smaller one.`);
  return true;
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

  if (await rejectIfOversize(ctx, buffer)) return;

  const statementId = await createStatementRecord(userId, "");
  const s3Key = `statements/${userId}/${statementId}`;
  try {
    await uploadStatement(s3Key, buffer, mimeType);
    await sql`UPDATE statements SET file_key = ${s3Key} WHERE id = ${statementId}`;
  } catch (err) {
    await updateStatementStatus(statementId, "failed", undefined, redactError(err));
    await ctx.reply(`❌ Upload failed: ${String(err)}`);
    return;
  }

  await ctx.reply("📤 Uploaded. Parsing transactions…");

  let transactions;
  try {
    transactions = await parseStatementBuffer(buffer, mimeType);
  } catch (err) {
    await updateStatementStatus(statementId, "failed", undefined, redactError(err));
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

  await setPendingImport(chatId, {
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
      "*Voice note:* Send a voice message — I'll transcribe locally and log it.\n\n" +
      "*Tag an expense:* After logging, reply `tag: <name>` (or comma-separated: `tag: work, lunch`).\n" +
      "Untag with `untag: <name>`.\n\n" +
      "*Commands:*\n" +
      "/ask <question> — ask anything about your spending\n" +
      "/expenses — list expenses from the 1st of the month till today\n" +
      "/export — download this month as Excel (or `/export YYYY-MM`)\n" +
      "/tags — list your tags with counts\n" +
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

// ── UPI / bank-payment fast path (text OR receipt OCR) ───────────────────────

interface UpiInsertOpts {
  source: "telegram" | "receipt";
  imageKey?: string;
  contentHash?: string;
}

async function processUpiPayment(
  ctx: Context,
  userId: number,
  rawText: string,
  upi: UpiParse,
  opts: UpiInsertOpts,
): Promise<void> {
  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides] = await Promise.all([
    getUserCategories(userId),
    getOverrides(userId),
  ]);

  // Prefer override-hinted category for the merchant; fall back to "Other".
  let categoryName = "Other";
  if (upi.merchant) {
    const merchLower = upi.merchant.toLowerCase();
    const override = overrides.find(
      (o) =>
        merchLower.includes(o.hint_text.toLowerCase()) ||
        o.hint_text.toLowerCase().includes(merchLower),
    );
    if (override) categoryName = override.category_name;
  }
  const cat =
    cats.find((c) => c.name === categoryName) ??
    cats.find((c) => c.name === "Other") ??
    null;

  const amount_cents = Math.round(upi.amountRupees * 100);
  const occurred_at = new Date(); // same-day; user can edit
  const description = upi.merchant ?? `UPI payment (${upi.app})`;

  const expenseId = await insertExpense({
    userId,
    amount_cents,
    currency: "INR",
    description,
    merchant: upi.merchant,
    category_id: cat?.id ?? null,
    occurred_at,
    source: opts.source,
    raw_text: rawText,
    image_key: opts.imageKey ?? null,
    content_hash: opts.contentHash ?? null,
  });

  await setPendingEdit(userId, {
    expenseId,
    amount_cents,
    currency: "INR",
    category: cat?.name ?? "Other",
    description,
    occurred_at,
  });

  const sourceLabel = opts.source === "receipt" ? "Receipt logged" : "UPI logged";
  await ctx.reply(
    `✅ ${sourceLabel}: ${formatAmount(amount_cents, "INR")} ${description} — ${cat?.name ?? "Other"} _via ${upi.app}_\n` +
      `Reply \`category: <name>\` or use the buttons.`,
    { parse_mode: "Markdown", reply_markup: editKeyboard(expenseId) },
  );
}

// ── Ask (chat with your data) ────────────────────────────────────────────────

/**
 * /ask <question>
 *
 * Free-form natural-language question about the user's expenses. Routes to
 * a multi-turn LLM agent that can call typed query tools (totals, top-N,
 * recurring detection, merchant search, etc.). Returns the model's text
 * answer.
 */
export async function handleAsk(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const question = (ctx.match?.toString() ?? "").trim();
  if (!question) {
    await ctx.reply(
      "Usage: `/ask <question>`\n\n" +
        "Examples:\n" +
        "• /ask how much did I spend on food this month?\n" +
        "• /ask top 5 expenses last week\n" +
        "• /ask what subscriptions am I paying for\n" +
        "• /ask compare food spend this month vs last month",
      { parse_mode: "Markdown" },
    );
    return;
  }

  await ctx.reply("🤔 Thinking…");

  try {
    const result = await chatWithData(question, userId, todayString());
    await ctx.reply(result.text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Ask error:", err);
    await ctx.reply(`⚠️ Couldn't answer that: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Tag commands ──────────────────────────────────────────────────────────────

export async function handleListTags(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const tags = await listTagsWithCounts(userId);
  if (tags.length === 0) {
    await ctx.reply(
      "📋 No tags yet. Tag an expense by replying `tag: <name>` after logging it.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  const lines = tags.map((t) => `• #${t.name} — ${t.count} expense${t.count !== 1 ? "s" : ""}`);
  await ctx.reply(`🏷️ *Your tags:*\n${lines.join("\n")}`, { parse_mode: "Markdown" });
}

// ── List expenses (month-to-date) ─────────────────────────────────────────────

interface ExpenseListRow {
  id: string;
  occurred_at: Date;
  amount_cents: string;
  currency: string;
  description: string | null;
  merchant: string | null;
  category: string;
}

export async function handleListExpenses(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const now = new Date();
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endStr = tomorrow.toISOString().substring(0, 10);
  const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const rows = await sql<ExpenseListRow[]>`
    SELECT e.id,
           e.occurred_at,
           e.amount_cents::text AS amount_cents,
           e.currency,
           e.description,
           e.merchant,
           COALESCE(c.name, 'Uncategorized') AS category
    FROM expenses e
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${monthStartStr}::date
      AND e.occurred_at < ${endStr}::date
    ORDER BY e.occurred_at DESC, e.created_at DESC
  `;

  if (rows.length === 0) {
    await ctx.reply(`No expenses logged in ${monthLabel} yet.`);
    return;
  }

  const currency = rows[0]!.currency;
  const total = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
  const totalStr = formatAmount(total, currency);

  // Per-category aggregate, sorted highest spend first.
  const byCategory = new Map<string, { totalCents: number; count: number }>();
  for (const r of rows) {
    const cur = byCategory.get(r.category) ?? { totalCents: 0, count: 0 };
    cur.totalCents += Number(r.amount_cents);
    cur.count += 1;
    byCategory.set(r.category, cur);
  }
  const categoryLines = [...byCategory.entries()]
    .sort((a, b) => b[1].totalCents - a[1].totalCents)
    .map(
      ([name, agg]) =>
        `• ${name} — ${formatAmount(agg.totalCents, currency)} (${agg.count})`,
    )
    .join("\n");

  // Bulk-fetch tags for all expenses in one query (Map<expenseId, names[]>)
  const tagMap = await getTagsForExpenses(rows.map((r) => r.id));

  // Per-expense lines, newest first.
  const lines = rows.map((r) => {
    const d = new Date(r.occurred_at);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const monAbbr = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const name = r.merchant ?? r.description ?? "—";
    const trimmed = name.length > 40 ? name.slice(0, 38) + "…" : name;
    const amt = formatAmount(Number(r.amount_cents), r.currency);
    const tagNames = tagMap.get(r.id) ?? [];
    const tagSuffix = tagNames.length ? ` ${tagNames.map((n) => `#${n}`).join(" ")}` : "";
    return `\`${day} ${monAbbr}\` ${amt} — ${trimmed} _(${r.category})_${tagSuffix}`;
  });

  const noun = rows.length === 1 ? "expense" : "expenses";
  const header = `📊 *${monthLabel} — ${rows.length} ${noun}, ${totalStr}*\n\n`;
  const categorySection = `*By category:*\n${categoryLines}\n\n`;

  // Telegram caps a single message at 4096 chars; leave a safety margin.
  const MAX_TOTAL = 3950;
  const baseLength = header.length + categorySection.length;
  const MAX_INDIVIDUAL = MAX_TOTAL - baseLength;

  const fullIndividual = lines.join("\n");
  let individualBody: string;
  if (fullIndividual.length <= MAX_INDIVIDUAL) {
    individualBody = fullIndividual;
  } else {
    let acc = "";
    let kept = 0;
    const FOOTER_RESERVE = 80;
    for (const line of lines) {
      if (acc.length + line.length + 1 > MAX_INDIVIDUAL - FOOTER_RESERVE) break;
      acc += line + "\n";
      kept++;
    }
    individualBody =
      acc.trimEnd() +
      `\n\n_…showing ${kept} of ${rows.length} entries. Use /export for full CSV._`;
  }

  await ctx.reply(header + categorySection + individualBody, { parse_mode: "Markdown" });
}

// ── Query handler ─────────────────────────────────────────────────────────────

async function handleQueryIntent(
  ctx: Context,
  userId: number,
  intent: QueryIntent,
): Promise<void> {
  const { category, time_range_label, start_date, end_date, group_by_category, top_n } = intent;
  try {
    if (top_n) {
      const rows = await topExpenses(userId, start_date, end_date, top_n);
      if (rows.length === 0) {
        await ctx.reply(`No expenses found for ${time_range_label}.`);
        return;
      }
      const lines = rows.map((r, i) => {
        const name = r.merchant ?? r.description;
        const date = new Date(r.occurred_at).toISOString().split("T")[0]!;
        return `${i + 1}. ${name} — ${formatAmount(Number(r.amount_cents), r.currency)} (${date})`;
      });
      await ctx.reply(
        `*Top ${rows.length} expenses — ${time_range_label}*\n${lines.join("\n")}`,
        { parse_mode: "Markdown" },
      );
    } else if (group_by_category) {
      const rows = await spendByCategory(userId, start_date, end_date);
      if (rows.length === 0) {
        await ctx.reply(`No expenses found for ${time_range_label}.`);
        return;
      }
      const lines = rows.map(
        (r) => `- ${r.category}: ${formatAmount(Number(r.total_cents), r.currency)}`,
      );
      const total = rows.reduce((s, r) => s + Number(r.total_cents), 0);
      const currency = rows[0]!.currency;
      await ctx.reply(
        `*Spend by category — ${time_range_label}*\n${lines.join("\n")}\n\n*Total: ${formatAmount(total, currency)}*`,
        { parse_mode: "Markdown" },
      );
    } else {
      const rows = await totalSpendInCategory(userId, category, start_date, end_date);
      if (rows.length === 0) {
        const catLabel = category ? ` on *${category}*` : "";
        await ctx.reply(
          `No expenses found${catLabel} for ${time_range_label}.`,
          { parse_mode: "Markdown" },
        );
        return;
      }
      const row = rows[0]!;
      const catLabel = category ? ` on *${category}*` : "";
      const txn = Number(row.count);
      await ctx.reply(
        `*${formatAmount(Number(row.total_cents), row.currency)}*${catLabel} — ${time_range_label} (${txn} transaction${txn !== 1 ? "s" : ""})`,
        { parse_mode: "Markdown" },
      );
    }
  } catch (err) {
    console.error("Query error:", err);
    await ctx.reply("⚠️ I couldn't fetch that data. Please try again.");
  }
}

// ── Text message handler ──────────────────────────────────────────────────────

export async function handleTextMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message?.text?.trim();
  if (!userId || !text) return;

  // Skip commands — registered separately on the bot
  if (text.startsWith("/")) return;

  // UPI / bank-payment receipt fast path — regex parse, skip LLM. The parser
  // is conservative (requires a payment signal AND a currency-marked amount),
  // so casual chat mentioning ₹ doesn't auto-log. Works for both forwarded
  // notifications AND pasted SMS bodies.
  const upi = tryParseUpi(text);
  if (upi) {
    await processUpiPayment(ctx, userId, text, upi, { source: "telegram" });
    return;
  }

  const chatId = ctx.chat?.id;
  const pendingEdit = await getPendingEdit(userId);

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
      await setPendingEdit(userId, { ...pendingEdit, amount_cents, currency, waitingFor: undefined });
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
      await setPendingEdit(userId, { ...pendingEdit, occurred_at, waitingFor: undefined });
    }
    await ctx.reply(ok ? `✅ Date updated to ${text}` : "⚠️ Failed to update date");
    return;
  }

  // Check for a pending statement import confirmation
  if (chatId) {
    const pendingImport = await getPendingImport(chatId);
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
          await clearPendingImport(chatId);
          await ctx.reply(
            `✅ Imported ${inserted} new transaction${inserted !== 1 ? "s" : ""}.`,
          );
        } catch (err) {
          await updateStatementStatus(
            pendingImport.statementId,
            "failed",
            undefined,
            redactError(err),
          );
          await clearPendingImport(chatId);
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

  // "tag: X" or "tag: a, b, c" — attach one or more tags to the last logged expense
  if (/^tag\s*:/i.test(text)) {
    if (!pendingEdit) {
      await ctx.reply("No recent expense to tag. Log one first.");
      return;
    }
    const names = text
      .replace(/^tag\s*:\s*/i, "")
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      await ctx.reply("Usage: `tag: <name>` (or comma-separated: `tag: work, lunch`)", {
        parse_mode: "Markdown",
      });
      return;
    }
    const attached: string[] = [];
    for (const name of names) {
      const tagId = await getOrCreateTag(userId, name);
      if (!tagId) continue;
      await attachTagToExpense(pendingEdit.expenseId, tagId);
      attached.push(name.toLowerCase().trim().replace(/\s+/g, " "));
    }
    if (attached.length === 0) {
      await ctx.reply("⚠️ No valid tag names provided.");
    } else {
      await ctx.reply(`✅ Tagged with ${attached.map((n) => `#${n}`).join(" ")}`);
    }
    return;
  }

  // "untag: X" — detach a tag from the last logged expense
  if (/^untag\s*:/i.test(text)) {
    if (!pendingEdit) {
      await ctx.reply("No recent expense to untag. Log one first.");
      return;
    }
    const name = text.replace(/^untag\s*:\s*/i, "").trim();
    if (!name) {
      await ctx.reply("Usage: `untag: <name>`", { parse_mode: "Markdown" });
      return;
    }
    const tag = await findTagByName(userId, name);
    if (!tag) {
      await ctx.reply(`⚠️ Tag "${name}" not found.`);
      return;
    }
    const removed = await detachTagFromExpense(pendingEdit.expenseId, tag.id);
    await ctx.reply(removed ? `✅ Removed #${tag.name}` : `⚠️ #${tag.name} wasn't on this expense.`);
    return;
  }

  // "category: X" quick correction for the last logged expense
  if (/^category\s*:/i.test(text)) {
    const catName = text.replace(/^category\s*:\s*/i, "").trim();
    if (!pendingEdit) {
      await ctx.reply("No recent expense to recategorize. Log one first.");
      return;
    }
    const cat = await getCategoryByName(userId, catName);
    if (!cat) {
      const allCats = await getUserCategories(userId);
      await ctx.reply(
        `⚠️ "${catName}" not found. Your categories: ${allCats.map((c) => c.name).join(", ")}`,
      );
      return;
    }
    const ok = await updateExpenseCategory(pendingEdit.expenseId, userId, cat.id);
    if (ok) {
      await upsertOverride(userId, pendingEdit.description.toLowerCase(), cat.name).catch(
        console.error,
      );
      await setPendingEdit(userId, { ...pendingEdit, category: cat.name });
    }
    await ctx.reply(ok ? `✅ Category updated to "${cat.name}"` : "⚠️ Failed to update category");
    return;
  }

  // Classify the message (expense vs spending query vs unknown)
  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides] = await Promise.all([getUserCategories(userId), getOverrides(userId)]);

  let classification;
  try {
    classification = await classifyMessage(
      text,
      cats.map((c) => c.name),
      overrides,
      todayString(),
    );
  } catch (err) {
    console.error("AI classify error:", err);
    await ctx.reply("⚠️ I had trouble parsing that. Try: `$45 lunch` or `paid 1200 for uber`");
    return;
  }

  if (classification.type === "query") {
    await handleQueryIntent(ctx, userId, classification.intent);
    return;
  }

  if (classification.type === "clarify") {
    await ctx.reply(classification.question);
    return;
  }

  if (classification.type !== "expense") {
    await ctx.reply(
      "🤔 That doesn't look like an expense. Try: `$45 lunch` or `paid 1200 for uber`",
    );
    return;
  }

  const parsed = classification.data;

  const cat =
    cats.find((c) => c.name.toLowerCase() === parsed.category.toLowerCase()) ??
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

  await setPendingEdit(userId, {
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

  const pending = await getPendingEdit(userId);

  if (data.startsWith("editcat:")) {
    const expenseId = data.slice(8);
    if (pending) await setPendingEdit(userId, { ...pending, expenseId });
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
      await setPendingEdit(userId, { ...pending, category: cat.name });
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(ok ? `✅ Category updated to "${cat.name}"` : "⚠️ Failed to update category");
    return;
  }

  if (data.startsWith("editamt:")) {
    if (pending) await setPendingEdit(userId, { ...pending, waitingFor: "amount" });
    await ctx.answerCallbackQuery();
    await ctx.reply("Enter new amount (e.g. `200` or `200 USD`):");
    return;
  }

  if (data.startsWith("editdt:")) {
    if (pending) await setPendingEdit(userId, { ...pending, waitingFor: "date" });
    await ctx.answerCallbackQuery();
    await ctx.reply("Enter new date (YYYY-MM-DD, e.g. `2026-04-26`):");
    return;
  }

  await ctx.answerCallbackQuery();
}

// ── Receipt OCR pipeline ──────────────────────────────────────────────────────

async function runReceiptPipeline(ctx: Context, fileId: string, mimeType: string): Promise<void> {
  const userId = ctx.from!.id;

  await ctx.reply("📷 Reading receipt…");

  let buffer: Buffer;
  try {
    ({ buffer } = await downloadTelegramFile(fileId));
  } catch (err) {
    await ctx.reply(`❌ Could not download the image: ${String(err)}`);
    return;
  }

  if (await rejectIfOversize(ctx, buffer)) return;

  // Idempotency: skip if the exact same image was already logged
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const existing = await findExpenseByContentHash(userId, contentHash);
  if (existing) {
    await ctx.reply("⚠️ This receipt was already logged. Skipping duplicate.");
    return;
  }

  // Upload original image to S3
  const receiptId = crypto.randomUUID();
  const s3Key = `receipts/${userId}/${receiptId}`;
  try {
    await uploadStatement(s3Key, buffer, mimeType);
  } catch (err) {
    await ctx.reply(`❌ Could not store the image: ${String(err)}`);
    return;
  }

  // OCR via Claude vision with a receipt-specific prompt
  let ocrText: string;
  try {
    const imageMime = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)
      ? mimeType
      : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    ocrText = await ocrReceiptImage(buffer, imageMime);
  } catch (err) {
    await ctx.reply(`❌ OCR failed: ${String(err)}\n\nPlease try a clearer, well-lit photo.`);
    return;
  }

  if (ocrText.trim().length < 20) {
    await ctx.reply(
      "⚠️ I couldn't read enough text from this image. Please send a clearer photo of the receipt.",
    );
    return;
  }

  // UPI / bank-payment receipt fast path — if the OCR'd text matches a
  // payment-confirmation pattern (Rs amount + UPI/app/debit keyword), use
  // the regex parse and skip the LLM. Bill-payment confirmations (AmEx,
  // credit-card statements) often confuse parseExpense, but the regex
  // catches them reliably.
  const upi = tryParseUpi(ocrText);
  if (upi) {
    await processUpiPayment(ctx, userId, ocrText, upi, {
      source: "receipt",
      imageKey: s3Key,
      contentHash: contentHash,
    });
    return;
  }

  // Otherwise: traditional retail receipts go through the LLM (better at
  // category inference and free-form merchant strings).
  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides] = await Promise.all([getUserCategories(userId), getOverrides(userId)]);

  let parsed;
  try {
    parsed = await parseExpense(ocrText, cats.map((c) => c.name), overrides, todayString());
  } catch (err) {
    console.error("Receipt parse error:", err);
    await ctx.reply(
      "⚠️ Could not extract expense details from this image. Is this a receipt or bill? Try a clearer photo.",
    );
    return;
  }

  if (!parsed) {
    await ctx.reply(
      "🤔 This doesn't look like a receipt or bill. If it is, try a clearer photo.\n\nFor manual entry, just type the amount and description.",
    );
    return;
  }

  const cat =
    cats.find((c) => c.name.toLowerCase() === parsed!.category.toLowerCase()) ??
    cats.find((c) => c.name === "Other") ??
    null;
  const amount_cents = Math.round(parsed.amount * 100);
  const occurred_at = new Date(parsed.occurred_at + "T12:00:00Z");

  let expenseId: string;
  try {
    expenseId = await insertExpense({
      userId,
      amount_cents,
      currency: parsed.currency,
      description: parsed.description,
      merchant: parsed.merchant,
      category_id: cat?.id ?? null,
      occurred_at,
      source: "receipt",
      raw_text: ocrText,
      image_key: s3Key,
      content_hash: contentHash,
    });
  } catch (err) {
    await ctx.reply(`❌ Failed to save expense: ${String(err)}`);
    return;
  }

  await setPendingEdit(userId, {
    expenseId,
    amount_cents,
    currency: parsed.currency,
    category: cat?.name ?? "Other",
    description: parsed.description,
    occurred_at,
  });

  const merchantPart = parsed.merchant ? ` at ${parsed.merchant}` : "";
  await ctx.reply(
    `✅ Receipt logged: ${formatAmount(amount_cents, parsed.currency)}${merchantPart} — ${cat?.name ?? "Other"}\n` +
      `Date: ${parsed.occurred_at}\n\n` +
      `Reply \`category: <name>\` to change category, or use the buttons below.`,
    { parse_mode: "Markdown", reply_markup: editKeyboard(expenseId) },
  );
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
  await runReceiptPipeline(ctx, photo.file_id, "image/jpeg");
}

/**
 * Voice note → local Whisper (whisper.cpp + ggml-tiny) → existing parse
 * pipeline. Stays entirely on Dalekdefender — no audio leaves the box.
 */
export async function handleVoice(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const voice = ctx.message?.voice;
  if (!userId || !voice) return;

  await ctx.reply("🎙️ Transcribing…");

  let buffer: Buffer;
  try {
    ({ buffer } = await downloadTelegramFile(voice.file_id));
  } catch (err) {
    await ctx.reply(`❌ Could not download voice note: ${redactError(err)}`);
    return;
  }
  if (await rejectIfOversize(ctx, buffer)) return;

  let text: string;
  try {
    text = await transcribeVoice(buffer);
  } catch (err) {
    await ctx.reply(`⚠️ Transcription failed: ${redactError(err)}`);
    return;
  }
  text = text.trim();

  if (text.length < 3) {
    await ctx.reply("⚠️ Couldn't make out any speech. Try again — speak clearly?");
    return;
  }

  await ctx.reply(`🎙️ _"${text}"_`, { parse_mode: "Markdown" });

  // Feed the transcription through the same classify-and-route flow as text.
  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides] = await Promise.all([
    getUserCategories(userId),
    getOverrides(userId),
  ]);

  let classification;
  try {
    classification = await classifyMessage(
      text,
      cats.map((c) => c.name),
      overrides,
      todayString(),
    );
  } catch (err) {
    console.error("Voice classify error:", err);
    await ctx.reply("⚠️ I had trouble parsing that voice note. Try a text message instead?");
    return;
  }

  if (classification.type === "query") {
    await handleQueryIntent(ctx, userId, classification.intent);
    return;
  }

  if (classification.type === "clarify") {
    await ctx.reply(classification.question);
    return;
  }

  if (classification.type !== "expense") {
    await ctx.reply(
      "🤔 That doesn't sound like an expense. Try `\"spent 500 at zomato\"` or `\"paid 1200 for uber yesterday\"`.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const parsed = classification.data;
  const cat =
    cats.find((c) => c.name.toLowerCase() === parsed.category.toLowerCase()) ??
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

  await setPendingEdit(userId, {
    expenseId,
    amount_cents,
    currency: parsed.currency,
    category: cat?.name ?? "Other",
    description: parsed.description,
    occurred_at,
  });

  await ctx.reply(
    `✅ Logged: ${formatAmount(amount_cents, parsed.currency)} ${parsed.description} — ${cat?.name ?? "Other"}. Reply \`edit\` to change.`,
    { parse_mode: "Markdown", reply_markup: editKeyboard(expenseId) },
  );
}

// ── Budget commands ───────────────────────────────────────────────────────────

export async function handleBudget(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/budget\s*/i, "").trim();
  const lower = args.toLowerCase();

  // /budget list (or bare /budget)
  if (lower === "list" || lower === "") {
    const budgets = await listBudgets(userId);
    if (budgets.length === 0) {
      await ctx.reply(
        "No budgets set yet. Use /budget set <category> <amount> to add one.",
      );
      return;
    }
    const lines = budgets.map(
      (b) => `• *${b.category_name}*: ${formatAmount(b.target_cents, "INR")}/month`,
    );
    await ctx.reply(`💰 *Your budgets:*\n${lines.join("\n")}`, { parse_mode: "Markdown" });
    return;
  }

  // /budget clear <category>
  const clearMatch = args.match(/^clear\s+(.+)$/i);
  if (clearMatch) {
    const catName = clearMatch[1]!.trim();
    const cat = await getCategoryByName(userId, catName);
    if (!cat) {
      await ctx.reply(`⚠️ Category "${catName}" not found.`);
      return;
    }
    const ok = await clearBudget(userId, cat.id);
    await ctx.reply(
      ok
        ? `✅ Budget for "${cat.name}" cleared.`
        : `⚠️ No budget was set for "${cat.name}".`,
    );
    return;
  }

  // /budget set <category> <amount>
  const setMatch = args.match(/^set\s+(.+?)\s+([\d]+(?:\.\d+)?)\s*(?:[A-Za-z]{3})?$/i);
  if (setMatch) {
    const catName = setMatch[1]!.trim();
    const amount = parseFloat(setMatch[2]!);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("Amount must be a positive number, e.g. /budget set Food 5000");
      return;
    }
    const cat = await getCategoryByName(userId, catName);
    if (!cat) {
      const allCats = await getUserCategories(userId);
      await ctx.reply(
        `⚠️ Category "${catName}" not found. Your categories: ${allCats.map((c) => c.name).join(", ")}`,
      );
      return;
    }
    const targetCents = Math.round(amount * 100);
    await setBudget(userId, cat.id, targetCents);
    await ctx.reply(
      `✅ Budget set: *${cat.name}* → ${formatAmount(targetCents, "INR")}/month`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  await ctx.reply(
    "💰 *Budget commands:*\n" +
      "• `/budget set <category> <amount>` — set monthly budget\n" +
      "• `/budget list` — view all budgets\n" +
      "• `/budget clear <category>` — remove a budget",
    { parse_mode: "Markdown" },
  );
}

/**
 * /export — sends a multi-sheet xlsx as a Telegram document attachment.
 *
 * Args (all optional, default = current month):
 *   /export                    → current month
 *   /export 2026-04            → that calendar month
 *   /export 2026-04-01 2026-04-30 → arbitrary date range
 */
export async function handleExport(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const args = (ctx.match?.toString() ?? "").trim();

  let start: string;
  let end: string;
  let rangeKey: string;
  const rangeMatch = args.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/);
  const monthMatch = args.match(/^(\d{4}-\d{2})$/);

  if (rangeMatch) {
    start = rangeMatch[1]!;
    end = rangeMatch[2]!;
    rangeKey = `${start}_${end}`;
  } else if (monthMatch) {
    const [y, m] = monthMatch[1]!.split("-").map(Number) as [number, number];
    const b = currentMonthBounds(y, m);
    start = b.start;
    end = b.end;
    rangeKey = b.rangeKey;
  } else {
    const now = new Date();
    const b = currentMonthBounds(now.getFullYear(), now.getMonth() + 1);
    start = b.start;
    end = b.end;
    rangeKey = b.rangeKey;
  }

  await ctx.reply("📊 Generating export…");

  const { buffer, filename, rowCount, totalCents, currency } = await buildMonthlyXlsx(
    userId,
    start,
    end,
    rangeKey,
  );

  if (rowCount === 0) {
    await ctx.reply(`No expenses found for ${start} → ${end}.`);
    return;
  }

  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption:
      `📊 ${start} → ${end}\n` +
      `${rowCount} expense${rowCount !== 1 ? "s" : ""}, ` +
      `${formatAmount(totalCents, currency)}`,
  });
}
