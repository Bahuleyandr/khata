import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import { uploadStatement } from "../storage/index.js";
import { buildMonthlyXlsx, currentMonthBounds, previousMonthBounds } from "../export/xlsx.js";
import { sql } from "../db/index.js";
import { todayIst, nowIstParts, formatIstDate } from "../lib/time.js";
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
  findExpenseByUpiRef,
  attachReceiptToExpense,
  deleteExpense,
  getExpenseForEdit,
} from "../db/expenses.js";
import { recordAuditEvent } from "../db/audit.js";
import { guessAccountFromText } from "../db/accounts.js";
import {
  markCaptureFailed,
  markCaptureProcessed,
  recordCaptureEvent,
  updateCaptureRawText,
} from "../db/captures.js";
import { resolveLedgerForTelegramUser } from "../db/access.js";
import { getOverrides, upsertOverride } from "../db/overrides.js";
import {
  getLearnedCategoryForMerchant,
  getMerchantCanonicalIdForExpense,
  setMerchantCategory,
} from "../db/merchants.js";
import {
  attachTagToExpense,
  detachTagFromExpense,
  findTagByName,
  getOrCreateTag,
  getTagsForExpenses,
  listTagsWithCounts,
} from "../db/tags.js";
import { applySmartRules } from "../db/smart-rules.js";
import { buildCaptureConfidence, reviewStatusFromConfidence } from "../capture/confidence.js";
import { parseExpense, classifyMessage, type QueryIntent } from "../ai/parse.js";
import { chatWithData } from "../ai/chat.js";
import { transcribeVoice } from "../voice/transcribe.js";
import { tryParseUpi, type UpiParse } from "../upi/parse.js";
import {
  totalSpendInCategory,
  topExpenses,
  topMerchants,
  spendByCategory,
  findSubscriptionCandidates,
} from "../db/query.js";
import { listSubscriptionRecords, summarizeSubscriptionRecords } from "../db/subscription-records.js";
import { convertCents, getFxRatesForCurrencies } from "../fx/rates.js";
import { ocrReceiptImage } from "../receipt/ocr.js";
import { tryParseReceiptText } from "../receipt/parse.js";
import { clearPendingEdit, getPendingEdit, setPendingEdit, type PendingEdit } from "./session.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayString(): string {
  return todayIst();
}

interface CommandPeriod {
  start: string;
  end: string;
  label: string;
  rangeKey: string;
  isCurrentMonth: boolean;
}

function toCommandPeriod(bounds: ReturnType<typeof currentMonthBounds>, isCurrentMonth: boolean): CommandPeriod {
  return {
    start: bounds.start,
    end: bounds.end,
    label: bounds.label,
    rangeKey: bounds.rangeKey,
    isCurrentMonth,
  };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseCommandPeriod(args: string, now: Date = new Date()): CommandPeriod | null {
  const trimmed = args.trim().toLowerCase();
  const { year: nowYear, month: nowMonth } = nowIstParts(now);
  const current = currentMonthBounds(nowYear, nowMonth);
  if (!trimmed || trimmed === "this" || trimmed === "this month" || trimmed === "current") {
    return toCommandPeriod(current, true);
  }
  if (
    trimmed === "last" ||
    trimmed === "last month" ||
    trimmed === "previous" ||
    trimmed === "prev"
  ) {
    return toCommandPeriod(previousMonthBounds(now), false);
  }

  const monthMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
    return toCommandPeriod(currentMonthBounds(year, month), current.rangeKey === trimmed);
  }

  const rangeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    const start = rangeMatch[1]!;
    const end = rangeMatch[2]!;
    if (!isValidDateOnly(start) || !isValidDateOnly(end) || start > end) return null;
    return {
      start,
      end,
      label: `${start} -> ${end}`,
      rangeKey: `${start}_${end}`,
      isCurrentMonth: false,
    };
  }

  return null;
}

function parseCommandPeriodKey(rangeKey: string, now: Date = new Date()): CommandPeriod | null {
  return parseCommandPeriod(rangeKey.replace("_", " "), now);
}

function parseLimitAndPeriod(
  args: string,
  defaultLimit: number,
  maxLimit: number,
): { limit: number; period: CommandPeriod | null; invalidPeriod: boolean } {
  const trimmed = args.trim();
  const match = trimmed.match(/^(\d{1,2})(?:\s+(.+))?$/);
  const limit = match ? Math.min(Math.max(Number(match[1]), 1), maxLimit) : defaultLimit;
  const periodText = match ? (match[2] ?? "") : trimmed;
  const period = parseCommandPeriod(periodText);
  return { limit, period, invalidPeriod: Boolean(periodText.trim()) && !period };
}

function actorUserId(ctx: Context): number {
  return (ctx as Context & { khataActorUserId?: number }).khataActorUserId ?? ctx.from!.id;
}

async function setPendingEditForActor(
  ctx: Context,
  ledgerUserId: number,
  data: PendingEdit,
): Promise<void> {
  const actorId = actorUserId(ctx);
  await setPendingEdit(actorId, { ...data, ledgerUserId });
  if (actorId !== ledgerUserId) {
    await setPendingEdit(ledgerUserId, { ...data, ledgerUserId }).catch(console.error);
  }
}

// ── /dashboard — open the Telegram Mini App ──────────────────────────────────

/**
 * Sends an inline reply with a `web_app` button. Tapping the button opens the
 * dashboard inside Telegram's webview (Mini App). Auth happens automatically
 * via Telegram.WebApp.initData on the dashboard side — no separate login.
 *
 * Falls back to a plain message if MINI_APP_URL isn't configured (the bot
 * works fine without the Mini App; this command just won't be useful).
 */
export async function handleDashboard(ctx: Context): Promise<void> {
  if (!config.miniAppUrl) {
    await ctx.reply(
      "📊 The Mini App URL isn't configured on the server yet (`MINI_APP_URL` env var). " +
        "Ask the operator to set it, then try again.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  await ctx.reply("📊 Open your dashboard inside Telegram:", {
    reply_markup: new InlineKeyboard().webApp("Open Dashboard", config.miniAppUrl),
  });
}

/**
 * After an explicit category correction (reply "category: X" or inline
 * keyboard pick), persist the user's choice on the canonical merchant so that
 * future expenses at the same merchant skip the LLM and use this category.
 * Best-effort — failures don't block the correction itself.
 */
async function rememberMerchantCategory(
  userId: number,
  expenseId: string,
  categoryId: string,
): Promise<void> {
  const merchantCanonicalId = await getMerchantCanonicalIdForExpense(userId, expenseId);
  if (merchantCanonicalId) {
    await setMerchantCategory(userId, merchantCanonicalId, categoryId).catch(console.error);
  }
}

function formatAmount(amount_cents: number, currency: string): string {
  const amount = amount_cents / 100;
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency + " ";
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function editActionData(action: string, ledgerUserId: number, expenseId: string): string {
  return `${action}:${ledgerUserId}:${expenseId}`;
}

function exportActionData(ledgerUserId: number, rangeKey: string): string {
  return `xprt:${ledgerUserId}:${rangeKey}`;
}

function commandKeyboard(ledgerUserId: number, period: CommandPeriod): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    "Download Excel",
    exportActionData(ledgerUserId, period.rangeKey),
  );
  if (config.miniAppUrl) {
    keyboard.row().webApp("Open Dashboard", config.miniAppUrl);
  }
  return keyboard;
}

function editKeyboard(expenseId: string, ledgerUserId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Change Category", editActionData("editcat", ledgerUserId, expenseId))
    .text("Edit Amount", editActionData("editamt", ledgerUserId, expenseId))
    .text("Edit Date", editActionData("editdt", ledgerUserId, expenseId))
    .row()
    .text("Delete Entry", editActionData("delexp", ledgerUserId, expenseId));
}

function backKeyboard(expenseId: string, ledgerUserId: number): InlineKeyboard {
  return new InlineKeyboard().text("Back", editActionData("backedit", ledgerUserId, expenseId));
}

function deleteConfirmKeyboard(expenseId: string, ledgerUserId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Delete Entry", editActionData("confirmdel", ledgerUserId, expenseId))
    .row()
    .text("Back", editActionData("backedit", ledgerUserId, expenseId));
}

function pendingLedgerUserId(userId: number, pending?: PendingEdit): number {
  return pending?.ledgerUserId ?? userId;
}

interface EditCallbackPayload {
  ledgerUserId: number;
  expenseId: string;
}

function parseEditCallbackPayload(data: string, action: string, fallbackLedgerUserId: number): EditCallbackPayload | null {
  const prefix = `${action}:`;
  if (!data.startsWith(prefix)) return null;
  const body = data.slice(prefix.length);
  const match = body.match(/^(-?\d+):(.+)$/);
  if (match) {
    const ledgerUserId = Number(match[1]);
    if (!Number.isSafeInteger(ledgerUserId) || ledgerUserId === 0) return null;
    return { ledgerUserId, expenseId: match[2]! };
  }
  return { ledgerUserId: fallbackLedgerUserId, expenseId: body };
}

async function resolveWritableCallbackLedger(
  actorUserId: number,
  ledgerUserId: number,
): Promise<number | null> {
  const access = await resolveLedgerForTelegramUser({
    telegramUserId: actorUserId,
    requestedLedgerId: ledgerUserId,
    requireWrite: true,
  });
  return access?.ledgerId ?? null;
}

async function loadPendingEditForCallback(
  ledgerUserId: number,
  expenseId: string,
  existing?: PendingEdit,
): Promise<PendingEdit | null> {
  if (existing?.expenseId === expenseId) {
    return { ...existing, ledgerUserId, waitingFor: undefined };
  }
  const expense = await getExpenseForEdit(expenseId, ledgerUserId);
  if (!expense) return null;
  return {
    expenseId,
    ledgerUserId,
    amount_cents: expense.amount_cents,
    currency: expense.currency,
    category: expense.category,
    description: expense.description ?? "expense",
    occurred_at: expense.occurred_at,
  };
}

function paymentMethodLabel(app: UpiParse["app"]): string {
  switch (app) {
    case "gpay":
      return "Google Pay";
    case "phonepe":
      return "PhonePe";
    case "paytm":
      return "Paytm";
    case "upi":
      return "UPI";
    case "bank":
      return "bank";
    case "card":
      return "credit card";
    case "amex":
      return "AmEx";
  }
}

function isNonUpiPaymentRail(app: UpiParse["app"]): boolean {
  return app === "bank" || app === "card" || app === "amex";
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

  const statementId = await createStatementRecord(userId, "", mimeType);
  const s3Key = `statements/${userId}/${statementId}`;
  let captureEventId: string | null = null;
  try {
    await uploadStatement(s3Key, buffer, mimeType);
    await sql`UPDATE statements SET file_key = ${s3Key}, mime_type = ${mimeType}, updated_at = NOW() WHERE id = ${statementId}`;
    captureEventId = await recordCaptureEvent({
      userId,
      source: "telegram_document",
      fileKey: s3Key,
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      mimeType,
      metadata: { file_name: fileName, statement_id: statementId, telegram_file_id: fileId },
    });
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
    await markCaptureFailed(userId, captureEventId, redactError(err));
    await ctx.reply(`❌ Parsing failed: ${String(err)}`);
    return;
  }

  if (transactions.length === 0) {
    await updateStatementStatus(statementId, "failed", 0, "No transactions found");
    await markCaptureFailed(userId, captureEventId, "No transactions found");
    await ctx.reply("⚠️ No transactions found in the statement.");
    return;
  }

  const results = await dedupeTransactions(userId, transactions);
  const alreadyLoggedCount = results.filter((r) => r.alreadyLogged).length;
  const newCount = results.length - alreadyLoggedCount;
  await updateStatementStatus(
    statementId,
    "parsed",
    results.length,
    undefined,
    undefined,
    alreadyLoggedCount,
  );

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
      "/month — this month's spend so far (`/month last` or `/month 2026-04`)\n" +
      "/top — biggest spends for a month\n" +
      "/merchants — top merchants for a month\n" +
      "/review — transactions that need cleanup\n" +
      "/subscriptions — recurring payments\n" +
      "/export — download this month as Excel\n" +
      "/dashboard — open the web dashboard\n" +
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
      "/month or /summary — spend summary (`/month last`, `/month 2026-04`)\n" +
      "/top [n] [period] — biggest spends (`/top 5 last`)\n" +
      "/merchants [n] [period] — top merchants (`/merchants 10 2026-04`)\n" +
      "/review or /needs_review — cleanup queue\n" +
      "/subscriptions — recurring payments and renewal watch\n" +
      "/expenses [period] — list expenses (`/expenses last`, `/expenses 2026-04`)\n" +
      "/export [period] — download Excel (`/export last`, `/export YYYY-MM`)\n" +
      "/dashboard — open the dashboard Mini App\n" +
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
  captureEventId?: string;
}

async function processUpiPayment(
  ctx: Context,
  userId: number,
  rawText: string,
  upi: UpiParse,
  opts: UpiInsertOpts,
): Promise<void> {
  // Dedup by UPI reference — if the same txn already arrived via the other
  // channel (SMS first, then receipt photo, or vice versa), attach the new
  // image if we have one and stop. Refs without bank ids (some SMS omit them)
  // fall through to the normal insert path.
  if (upi.reference) {
    const existing = await findExpenseByUpiRef(userId, upi.reference);
    if (existing) {
      let attached = false;
      if (opts.imageKey && opts.contentHash && !existing.image_key) {
        attached = await attachReceiptToExpense(
          existing.id,
          userId,
          opts.imageKey,
          opts.contentHash,
        ).catch(() => false);
      }
      const note = attached
        ? `📎 Receipt attached — same UPI txn (\`${upi.reference}\`) was already logged.`
        : `🔁 Already logged (UPI ref \`${upi.reference}\`).`;
      await markCaptureProcessed(userId, opts.captureEventId, existing.id);
      await ctx.reply(note, { parse_mode: "Markdown" });
      return;
    }
  }

  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides, learnedCategoryId] = await Promise.all([
    getUserCategories(userId),
    getOverrides(userId),
    getLearnedCategoryForMerchant(userId, upi.merchant),
  ]);

  // Category precedence: per-merchant memory (explicit prior correction) >
  // description-keyed override hint > "Other" fallback.
  let cat: { id: string; name: string } | null = null;
  if (learnedCategoryId) {
    cat = cats.find((c) => c.id === learnedCategoryId) ?? null;
  }
  if (!cat) {
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
    cat =
      cats.find((c) => c.name === categoryName) ??
      cats.find((c) => c.name === "Other") ??
      null;
  }

  const amount_cents = Math.round(upi.amountRupees * 100);
  const occurred_at = upi.occurredOn
    ? new Date(`${upi.occurredOn}T12:00:00Z`)
    : new Date(); // same-day fallback; user can edit
  const description = upi.merchant ?? `UPI payment (${upi.app})`;
  const rule = await applySmartRules(userId, {
    merchant: upi.merchant,
    description,
    rawText,
  });
  const accountId = rule.account_id ?? (await guessAccountFromText(userId, rawText));
  const categoryId = rule.category_id ?? cat?.id ?? null;
  const categoryName =
    cats.find((candidate) => candidate.id === categoryId)?.name ?? cat?.name ?? "Other";
  const reviewStatus = rule.review_status ?? (opts.source === "receipt" ? "needs_review" : "reviewed");
  const confidence = buildCaptureConfidence({
    amountCents: amount_cents,
    occurredAt: occurred_at,
    merchant: upi.merchant,
    description,
    categoryId,
    accountId,
    source: opts.source,
    ruleId: rule.rule_id,
    parser: "upi_regex",
    rawText,
  });
  const finalReviewStatus = rule.review_status ?? reviewStatusFromConfidence(reviewStatus, confidence);

  const expenseId = await insertExpense({
    userId,
    amount_cents,
    currency: "INR",
    description,
    merchant: upi.merchant,
    category_id: categoryId,
    occurred_at,
    source: opts.source,
    raw_text: rawText,
    image_key: opts.imageKey ?? null,
    content_hash: opts.contentHash ?? null,
    upi_reference_id: upi.reference,
    review_status: finalReviewStatus,
    account_id: accountId,
    capture_event_id: opts.captureEventId ?? null,
    confidence,
    paid_by_user_id: actorUserId(ctx),
    settlement_scope: userId < 0 ? "shared" : "personal",
    actorUserId: actorUserId(ctx),
  });
  for (const rawName of rule.tag_names) {
    const tagId = await getOrCreateTag(userId, rawName);
    if (tagId) await attachTagToExpense(expenseId, tagId);
  }
  await markCaptureProcessed(userId, opts.captureEventId, expenseId, confidence);

  await setPendingEditForActor(ctx, userId, {
    expenseId,
    amount_cents,
    currency: "INR",
    category: categoryName,
    description,
    occurred_at,
  });

  const sourceLabel =
    opts.source === "receipt"
      ? "Receipt logged"
      : isNonUpiPaymentRail(upi.app)
        ? "Payment logged"
        : "UPI logged";
  const methodLabel = paymentMethodLabel(upi.app);
  await ctx.reply(
    `✅ ${sourceLabel}: ${formatAmount(amount_cents, "INR")} ${description} — ${categoryName} _via ${methodLabel}_\n` +
      `Reply \`category: <name>\` or use the buttons.`,
    { parse_mode: "Markdown", reply_markup: editKeyboard(expenseId, userId) },
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

  const period = parseCommandPeriod((ctx.match?.toString() ?? "").trim());
  if (!period) {
    await ctx.reply("Usage: `/expenses`, `/expenses last`, or `/expenses 2026-04`", {
      parse_mode: "Markdown",
    });
    return;
  }

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
      AND e.occurred_at >= ${period.start}::date
      AND e.occurred_at < (${period.end}::date + INTERVAL '1 day')
    ORDER BY e.occurred_at DESC, e.created_at DESC
  `;

  if (rows.length === 0) {
    await ctx.reply(`No expenses logged in ${period.label}${period.isCurrentMonth ? " yet" : ""}.`);
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
  const header = `📊 *${period.label} — ${rows.length} ${noun}, ${totalStr}*\n\n`;
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
      `\n\n_...showing ${kept} of ${rows.length} entries. Use /export ${period.rangeKey} for full Excel._`;
  }

  await ctx.reply(header + categorySection + individualBody, {
    parse_mode: "Markdown",
    reply_markup: commandKeyboard(userId, period),
  });
}

export async function handleMonthSummary(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const period = parseCommandPeriod((ctx.match?.toString() ?? "").trim());
  if (!period) {
    await ctx.reply("Usage: `/month`, `/month last`, or `/month 2026-04`", {
      parse_mode: "Markdown",
    });
    return;
  }
  const [overview] = await sql<Array<{
    total_cents: string;
    transaction_count: number;
    needs_review_count: number;
    uncategorized_count: number;
  }>>`
    SELECT COALESCE(SUM(amount_cents), 0)::text AS total_cents,
           COUNT(*)::int AS transaction_count,
           COUNT(*) FILTER (WHERE review_status = 'needs_review')::int AS needs_review_count,
           COUNT(*) FILTER (WHERE category_id IS NULL)::int AS uncategorized_count
    FROM expenses
    WHERE user_id = ${userId}
      AND occurred_at >= ${period.start}::date
      AND occurred_at < (${period.end}::date + INTERVAL '1 day')
  `;
  const [categories, merchants, largest] = await Promise.all([
    spendByCategory(userId, period.start, period.end),
    topMerchants(userId, period.start, period.end, 3),
    topExpenses(userId, period.start, period.end, 3),
  ]);
  const topLines = categories.slice(0, 5).map(
    (row) => `• ${row.category}: ${formatAmount(Number(row.total_cents), row.currency)}`,
  );
  const merchantLines = merchants.map(
    (row) => `• ${row.merchant}: ${formatAmount(Number(row.total_cents), row.currency)} (${row.count})`,
  );
  const largestLines = largest.map((row, index) => {
    const name = row.merchant ?? row.description ?? "expense";
    return `${index + 1}. ${name}: ${formatAmount(Number(row.amount_cents), row.currency)}`;
  });
  const total = Number(overview?.total_cents ?? 0);
  await ctx.reply(
    `📊 *${period.label}${period.isCurrentMonth ? " so far" : ""}*\n` +
      `Total: *${formatAmount(total, "INR")}* across ${overview?.transaction_count ?? 0} transaction${overview?.transaction_count === 1 ? "" : "s"}.\n` +
      `${topLines.length ? `\n*Top categories:*\n${topLines.join("\n")}\n` : ""}` +
      `${merchantLines.length ? `\n*Top merchants:*\n${merchantLines.join("\n")}\n` : ""}` +
      `${largestLines.length ? `\n*Largest spends:*\n${largestLines.join("\n")}\n` : ""}` +
      `\nNeeds review: ${overview?.needs_review_count ?? 0} · Uncategorized: ${overview?.uncategorized_count ?? 0}\n\n` +
      `Use /export ${period.rangeKey} for Excel or /review for cleanup.`,
    { parse_mode: "Markdown", reply_markup: commandKeyboard(userId, period) },
  );
}

export async function handleTopExpenses(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const parsed = parseLimitAndPeriod((ctx.match?.toString() ?? "").trim(), 5, 15);
  if (parsed.invalidPeriod || !parsed.period) {
    await ctx.reply("Usage: `/top`, `/top 5 last`, or `/top 10 2026-04`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const rows = await topExpenses(userId, parsed.period.start, parsed.period.end, parsed.limit);
  if (rows.length === 0) {
    await ctx.reply(`No expenses found for ${parsed.period.label}.`);
    return;
  }

  const lines = rows.map((row, index) => {
    const date = formatIstDate(new Date(row.occurred_at));
    const name = row.merchant ?? row.description ?? "expense";
    return `${index + 1}. ${formatAmount(Number(row.amount_cents), row.currency)} - ${name} (${date}, ${row.category ?? "Uncategorized"})`;
  });
  await ctx.reply(`Top ${rows.length} expenses - ${parsed.period.label}\n${lines.join("\n")}`, {
    reply_markup: commandKeyboard(userId, parsed.period),
  });
}

export async function handleTopMerchants(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const parsed = parseLimitAndPeriod((ctx.match?.toString() ?? "").trim(), 8, 20);
  if (parsed.invalidPeriod || !parsed.period) {
    await ctx.reply("Usage: `/merchants`, `/merchants 10 last`, or `/merchants 10 2026-04`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const rows = await topMerchants(userId, parsed.period.start, parsed.period.end, parsed.limit);
  if (rows.length === 0) {
    await ctx.reply(`No merchant spend found for ${parsed.period.label}.`);
    return;
  }

  const lines = rows.map(
    (row, index) =>
      `${index + 1}. ${formatAmount(Number(row.total_cents), row.currency)} - ${row.merchant} (${row.count} txn, ${row.first_seen} to ${row.last_seen})`,
  );
  await ctx.reply(`Top ${rows.length} merchants - ${parsed.period.label}\n${lines.join("\n")}`, {
    reply_markup: commandKeyboard(userId, parsed.period),
  });
}

export async function handleNeedsReview(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const rows = await sql<Array<{
    id: string;
    amount_cents: string;
    currency: string;
    merchant: string | null;
    description: string | null;
    category: string;
    occurred_at: Date;
  }>>`
    SELECT e.id,
           e.amount_cents::text,
           e.currency,
           e.merchant,
           e.description,
           COALESCE(c.name, 'Uncategorized') AS category,
           e.occurred_at
    FROM expenses e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = ${userId}
      AND (e.review_status = 'needs_review' OR e.category_id IS NULL)
    ORDER BY e.occurred_at DESC, e.created_at DESC
    LIMIT 10
  `;
  if (rows.length === 0) {
    await ctx.reply("✅ Nothing needs review right now.");
    return;
  }
  const lines = rows.map((row) => {
    const name = row.merchant ?? row.description ?? "expense";
    const date = formatIstDate(new Date(row.occurred_at));
    return `• ${formatAmount(Number(row.amount_cents), row.currency)} ${name} — ${row.category} (${date})`;
  });
  await ctx.reply(
    `🧾 *Needs review*\n${lines.join("\n")}\n\nReply \`edit\` after logging, or open /dashboard for bulk fixes.`,
    { parse_mode: "Markdown" },
  );
}

export async function handleSubscriptions(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const [records, candidates] = await Promise.all([
    listSubscriptionRecords(userId),
    findSubscriptionCandidates(userId, 6, 2, { includeIgnored: false }),
  ]);
  const summary = summarizeSubscriptionRecords(records);
  const fx = await getFxRatesForCurrencies(records.map((record) => record.currency));
  const convertedMonthlyTotal = records
    .filter((record) => record.status === "active" || record.status === "trial")
    .reduce((sum, record) => sum + (convertCents(record.monthly_estimate_cents, record.currency, fx) ?? 0), 0);
  const managedKeys = new Set(records.map((record) => record.merchant_key).filter(Boolean));
  const activeRecords = records.filter((record) => record.status === "active" || record.status === "trial");
  const reviewCandidates = candidates.filter((candidate) => !managedKeys.has(candidate.merchant_key)).slice(0, 5);

  const lines: string[] = [
    "Subscriptions",
    `Monthly committed: ${formatAmount(convertedMonthlyTotal || Number(summary.monthly_total_cents), fx.base_currency)} (${activeRecords.length} active/trial)`,
  ];
  if (fx.missing_currencies.length > 0) {
    lines.push(`FX missing for: ${fx.missing_currencies.join(", ")}`);
  } else if (fx.stale) {
    lines.push("FX rates are using cached fallback values.");
  }

  if (summary.due_soon_count > 0 || summary.overdue_count > 0) {
    lines.push(`Renewals: ${summary.due_soon_count} due soon, ${summary.overdue_count} overdue`);
  }

  if (activeRecords.length > 0) {
    lines.push("", "Managed:");
    for (const record of activeRecords.slice(0, 8)) {
      const due =
        record.days_until_next === null
          ? "due date not set"
          : record.days_until_next < 0
            ? `${Math.abs(record.days_until_next)}d overdue`
            : record.days_until_next === 0
              ? "due today"
              : `due in ${record.days_until_next}d`;
      const converted = convertCents(record.monthly_estimate_cents, record.currency, fx);
      const amount =
        converted !== null && record.currency !== fx.base_currency
          ? `${formatAmount(Number(record.monthly_estimate_cents), record.currency)}/mo (${formatAmount(converted, fx.base_currency)})`
          : `${formatAmount(Number(record.monthly_estimate_cents), record.currency)}/mo`;
      lines.push(`• ${record.name}: ${amount}, ${due}`);
    }
  }

  if (reviewCandidates.length > 0) {
    lines.push("", "Detected:");
    for (const candidate of reviewCandidates) {
      lines.push(
        `• ${candidate.merchant}: ${candidate.confidence}% confidence, ${formatAmount(Number(candidate.monthly_estimate_cents), candidate.currency)}/mo`,
      );
    }
  }

  lines.push("", "Open /dashboard -> Subscriptions to edit, confirm, or add plans.");
  await ctx.reply(lines.join("\n"));
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
        const date = formatIstDate(new Date(r.occurred_at));
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
    const captureEventId = await recordCaptureEvent({
      userId,
      source: "telegram_text",
      rawText: text,
      metadata: { parser: "upi_regex", telegram_message_id: ctx.message?.message_id },
    });
    try {
      await processUpiPayment(ctx, userId, text, upi, { source: "telegram", captureEventId });
    } catch (err) {
      // Mark the capture failed and tell the user — do NOT rethrow. A transient
      // DB/MinIO blip on a forwarded UPI SMS must not crash the long-poll loop.
      await markCaptureFailed(userId, captureEventId, (err as Error).message);
      await ctx.reply(
        "⚠️ Couldn't save that payment just now — it's flagged for review. Please try again.",
      );
    }
    return;
  }

  const chatId = ctx.chat?.id;
  const pendingEdit = await getPendingEdit(userId);
  const editLedgerUserId = pendingLedgerUserId(userId, pendingEdit);

  // "edit" shortcut — re-show edit keyboard for last logged expense
  if (text.toLowerCase() === "edit") {
    if (!pendingEdit) {
      await ctx.reply("Nothing to edit yet. Log an expense first.");
      return;
    }
    await ctx.reply(
      `Editing: ${formatAmount(pendingEdit.amount_cents, pendingEdit.currency)} ${pendingEdit.description} — ${pendingEdit.category}`,
      { reply_markup: editKeyboard(pendingEdit.expenseId, pendingLedgerUserId(userId, pendingEdit)) },
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
    const ok = await updateExpenseAmount(
      pendingEdit.expenseId,
      editLedgerUserId,
      amount_cents,
      currency,
      actorUserId(ctx),
    );
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
    const ok = await updateExpenseDate(pendingEdit.expenseId, editLedgerUserId, occurred_at, actorUserId(ctx));
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
            undefined,
            inserted,
            pendingImport.alreadyLoggedCount,
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
      const tagId = await getOrCreateTag(editLedgerUserId, name);
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
    const tag = await findTagByName(editLedgerUserId, name);
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
    const cat = await getCategoryByName(editLedgerUserId, catName);
    if (!cat) {
      const allCats = await getUserCategories(editLedgerUserId);
      await ctx.reply(
        `⚠️ "${catName}" not found. Your categories: ${allCats.map((c) => c.name).join(", ")}`,
      );
      return;
    }
    const ok = await updateExpenseCategory(pendingEdit.expenseId, editLedgerUserId, cat.id, actorUserId(ctx));
    if (ok) {
      await upsertOverride(editLedgerUserId, pendingEdit.description.toLowerCase(), cat.name).catch(
        console.error,
      );
      await rememberMerchantCategory(editLedgerUserId, pendingEdit.expenseId, cat.id);
      await setPendingEdit(userId, { ...pendingEdit, category: cat.name });
    }
    await ctx.reply(ok ? `✅ Category updated to "${cat.name}"` : "⚠️ Failed to update category");
    return;
  }

  // Classify the message (expense vs spending query vs unknown)
  const captureEventId = await recordCaptureEvent({
    userId,
    source: "telegram_text",
    rawText: text,
    metadata: { parser: "classify_message", telegram_message_id: ctx.message?.message_id },
  });
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
    await markCaptureFailed(userId, captureEventId, (err as Error).message);
    await ctx.reply("⚠️ I had trouble parsing that. Try: `$45 lunch` or `paid 1200 for uber`");
    return;
  }

  if (classification.type === "query") {
    await markCaptureProcessed(userId, captureEventId, null);
    await handleQueryIntent(ctx, userId, classification.intent);
    return;
  }

  if (classification.type === "clarify") {
    await markCaptureProcessed(userId, captureEventId, null);
    await ctx.reply(classification.question);
    return;
  }

  if (classification.type !== "expense") {
    await markCaptureFailed(userId, captureEventId, "Message was not classified as an expense");
    await ctx.reply(
      "🤔 That doesn't look like an expense. Try: `$45 lunch` or `paid 1200 for uber`",
    );
    return;
  }

  const parsed = classification.data;

  // Per-merchant memory wins over the LLM's category guess when present.
  const learnedCategoryId = await getLearnedCategoryForMerchant(userId, parsed.merchant);
  const cat: { id: string; name: string } | null =
    (learnedCategoryId && cats.find((c) => c.id === learnedCategoryId)) ||
    cats.find((c) => c.name.toLowerCase() === parsed.category.toLowerCase()) ||
    cats.find((c) => c.name === "Other") ||
    null;

  const amount_cents = Math.round(parsed.amount * 100);
  const occurred_at = new Date(parsed.occurred_at + "T12:00:00Z");
  const rule = await applySmartRules(userId, {
    merchant: parsed.merchant,
    description: parsed.description,
    rawText: text,
  });
  const accountId = rule.account_id ?? (await guessAccountFromText(userId, text));
  const categoryId = rule.category_id ?? cat?.id ?? null;
  const categoryName = cats.find((candidate) => candidate.id === categoryId)?.name ?? cat?.name ?? "Other";
  const confidence = buildCaptureConfidence({
    amountCents: amount_cents,
    occurredAt: occurred_at,
    merchant: parsed.merchant,
    description: parsed.description,
    categoryId,
    accountId,
    source: "telegram",
    ruleId: rule.rule_id,
    parser: "llm",
    rawText: text,
  });

  const expenseId = await insertExpense({
    userId,
    amount_cents,
    currency: parsed.currency,
    description: parsed.description,
    merchant: parsed.merchant,
    category_id: categoryId,
    occurred_at,
    source: "telegram",
    raw_text: text,
    review_status: rule.review_status ?? reviewStatusFromConfidence(undefined, confidence),
    account_id: accountId,
    capture_event_id: captureEventId,
    confidence,
    paid_by_user_id: actorUserId(ctx),
    settlement_scope: userId < 0 ? "shared" : "personal",
    actorUserId: actorUserId(ctx),
  });
  for (const rawName of rule.tag_names) {
    const tagId = await getOrCreateTag(userId, rawName);
    if (tagId) await attachTagToExpense(expenseId, tagId);
  }
  await markCaptureProcessed(userId, captureEventId, expenseId, confidence);

  await setPendingEditForActor(ctx, userId, {
    expenseId,
    amount_cents,
    currency: parsed.currency,
    category: categoryName,
    description: parsed.description,
    occurred_at,
  });

  await ctx.reply(
    `Logged: ${formatAmount(amount_cents, parsed.currency)} ${parsed.description} — ${categoryName}. Reply edit to change.`,
    { reply_markup: editKeyboard(expenseId, userId) },
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

  if (data.startsWith("xprt:")) {
    const match = data.match(/^xprt:(-?\d+):(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery("Invalid export action");
      return;
    }
    const ledgerUserId = Number(match[1]);
    const period = parseCommandPeriodKey(match[2]!);
    if (!Number.isSafeInteger(ledgerUserId) || !period) {
      await ctx.answerCallbackQuery("Invalid export range");
      return;
    }
    const access = await resolveLedgerForTelegramUser({
      telegramUserId: userId,
      requestedLedgerId: ledgerUserId,
    });
    if (!access) {
      await ctx.answerCallbackQuery("You do not have permission to view this ledger");
      return;
    }
    await ctx.answerCallbackQuery("Generating export");
    await sendPeriodExport(ctx, access.ledgerId, period);
    return;
  }

  if (data.startsWith("editcat:")) {
    const payload = parseEditCallbackPayload(data, "editcat", userId);
    if (!payload) {
      await ctx.answerCallbackQuery("Invalid edit action");
      return;
    }
    const ledgerUserId = await resolveWritableCallbackLedger(userId, payload.ledgerUserId);
    if (!ledgerUserId) {
      await ctx.answerCallbackQuery("You do not have permission to edit this ledger");
      return;
    }
    const nextPending = await loadPendingEditForCallback(
      ledgerUserId,
      payload.expenseId,
      pending,
    );
    if (!nextPending) {
      await ctx.answerCallbackQuery("Transaction not found");
      return;
    }
    await setPendingEdit(userId, nextPending);
    const cats = await getUserCategories(ledgerUserId);
    const keyboard = new InlineKeyboard();
    cats.forEach((c, i) => {
      keyboard.text(c.name, `sc:${c.id}`);
      if ((i + 1) % 3 === 0) keyboard.row();
    });
    keyboard.row().text("Back", editActionData("backedit", ledgerUserId, payload.expenseId));
    await ctx.answerCallbackQuery();
    await ctx.reply("Select new category:", { reply_markup: keyboard });
    return;
  }

  if (data.startsWith("sc:")) {
    if (!pending) {
      await ctx.answerCallbackQuery("Session expired — log an expense first");
      return;
    }
    const ledgerUserId = pendingLedgerUserId(userId, pending);
    const catSelector = data.slice(3);
    const cats = await getUserCategories(ledgerUserId);
    const cat =
      cats.find((candidate) => candidate.id === catSelector) ??
      (await getCategoryByName(ledgerUserId, catSelector));
    if (!cat) {
      await ctx.answerCallbackQuery("Category not found");
      return;
    }
    const ok = await updateExpenseCategory(pending.expenseId, ledgerUserId, cat.id, actorUserId(ctx));
    if (ok) {
      if (pending.description && cat.name !== pending.category) {
        await upsertOverride(ledgerUserId, pending.description.toLowerCase(), cat.name).catch(
          console.error,
        );
      }
      await rememberMerchantCategory(ledgerUserId, pending.expenseId, cat.id);
      await setPendingEdit(userId, { ...pending, category: cat.name });
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(ok ? `✅ Category updated to "${cat.name}"` : "⚠️ Failed to update category");
    return;
  }

  if (data.startsWith("editamt:")) {
    const payload = parseEditCallbackPayload(data, "editamt", userId);
    if (!payload) {
      await ctx.answerCallbackQuery("Invalid edit action");
      return;
    }
    const ledgerUserId = await resolveWritableCallbackLedger(userId, payload.ledgerUserId);
    if (!ledgerUserId) {
      await ctx.answerCallbackQuery("You do not have permission to edit this ledger");
      return;
    }
    const nextPending = await loadPendingEditForCallback(
      ledgerUserId,
      payload.expenseId,
      pending,
    );
    if (!nextPending) {
      await ctx.answerCallbackQuery("Transaction not found");
      return;
    }
    await setPendingEdit(userId, { ...nextPending, waitingFor: "amount" });
    await ctx.answerCallbackQuery();
    await ctx.reply("Enter new amount (e.g. `200` or `200 USD`):", {
      reply_markup: backKeyboard(payload.expenseId, ledgerUserId),
    });
    return;
  }

  if (data.startsWith("editdt:")) {
    const payload = parseEditCallbackPayload(data, "editdt", userId);
    if (!payload) {
      await ctx.answerCallbackQuery("Invalid edit action");
      return;
    }
    const ledgerUserId = await resolveWritableCallbackLedger(userId, payload.ledgerUserId);
    if (!ledgerUserId) {
      await ctx.answerCallbackQuery("You do not have permission to edit this ledger");
      return;
    }
    const nextPending = await loadPendingEditForCallback(
      ledgerUserId,
      payload.expenseId,
      pending,
    );
    if (!nextPending) {
      await ctx.answerCallbackQuery("Transaction not found");
      return;
    }
    await setPendingEdit(userId, { ...nextPending, waitingFor: "date" });
    await ctx.answerCallbackQuery();
    await ctx.reply("Enter new date (YYYY-MM-DD, e.g. `2026-04-26`):", {
      reply_markup: backKeyboard(payload.expenseId, ledgerUserId),
    });
    return;
  }

  if (data.startsWith("delexp:")) {
    const payload = parseEditCallbackPayload(data, "delexp", userId);
    if (!payload) {
      await ctx.answerCallbackQuery("Invalid delete action");
      return;
    }
    const ledgerUserId = await resolveWritableCallbackLedger(userId, payload.ledgerUserId);
    if (!ledgerUserId) {
      await ctx.answerCallbackQuery("You do not have permission to edit this ledger");
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply("Delete this entry? This cannot be undone from Telegram.", {
      reply_markup: deleteConfirmKeyboard(payload.expenseId, ledgerUserId),
    });
    return;
  }

  if (data.startsWith("confirmdel:")) {
    const payload = parseEditCallbackPayload(data, "confirmdel", userId);
    if (!payload) {
      await ctx.answerCallbackQuery("Invalid delete action");
      return;
    }
    const ledgerUserId = await resolveWritableCallbackLedger(userId, payload.ledgerUserId);
    if (!ledgerUserId) {
      await ctx.answerCallbackQuery("You do not have permission to edit this ledger");
      return;
    }
    const deleted = await deleteExpense(payload.expenseId, ledgerUserId);
    if (!deleted) {
      await ctx.answerCallbackQuery("Transaction not found");
      return;
    }
    await recordAuditEvent({
      userId: ledgerUserId,
      actorUserId: userId,
      action: "expense.delete",
      entityType: "expense",
      entityId: deleted.id,
      before: deleted,
      metadata: { source: "telegram" },
    });
    if (pending?.expenseId === payload.expenseId) {
      await clearPendingEdit(userId);
    }
    if (ledgerUserId !== userId) {
      await clearPendingEdit(ledgerUserId).catch(console.error);
    }
    await ctx.answerCallbackQuery("Deleted");
    await ctx.reply("🗑️ Entry deleted.");
    return;
  }

  if (data.startsWith("backedit:")) {
    const payload = parseEditCallbackPayload(data, "backedit", userId);
    if (!payload) {
      await ctx.answerCallbackQuery("Invalid edit action");
      return;
    }
    const ledgerUserId = await resolveWritableCallbackLedger(userId, payload.ledgerUserId);
    if (!ledgerUserId) {
      await ctx.answerCallbackQuery("You do not have permission to edit this ledger");
      return;
    }
    const nextPending =
      (await loadPendingEditForCallback(ledgerUserId, payload.expenseId, pending)) ?? pending;
    if (nextPending) {
      await setPendingEdit(userId, { ...nextPending, ledgerUserId, waitingFor: undefined });
    }
    await ctx.answerCallbackQuery("No changes made");
    await ctx.reply("No changes made. Choose another action:", {
      reply_markup: editKeyboard(payload.expenseId, ledgerUserId),
    });
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

  const captureEventId = await recordCaptureEvent({
    userId,
    source: "telegram_photo",
    fileKey: s3Key,
    contentHash,
    mimeType,
    metadata: { telegram_file_id: fileId },
  });

  // OCR via MiniMax MCP vision with a receipt-specific prompt.
  let ocrText: string;
  try {
    const imageMime = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)
      ? mimeType
      : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    ocrText = await ocrReceiptImage(buffer, imageMime);
    await updateCaptureRawText(userId, captureEventId, ocrText);
  } catch (err) {
    await markCaptureFailed(userId, captureEventId, (err as Error).message);
    await ctx.reply(`❌ OCR failed: ${String(err)}\n\nPlease try a clearer, well-lit photo.`);
    return;
  }

  if (ocrText.trim().length < 20) {
    await markCaptureFailed(userId, captureEventId, "OCR returned too little text");
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
      captureEventId,
    });
    return;
  }

  // Otherwise: traditional retail receipts first get a deterministic POS
  // receipt pass. If that misses, fall back to the LLM for messier layouts.
  await seedDefaultCategories(userId).catch(console.error);
  const [cats, overrides] = await Promise.all([getUserCategories(userId), getOverrides(userId)]);

  let parsed = tryParseReceiptText(
    ocrText,
    cats.map((c) => c.name),
    todayString(),
  );
  if (!parsed) {
    try {
      parsed = await parseExpense(ocrText, cats.map((c) => c.name), overrides, todayString());
    } catch (err) {
      console.error("Receipt parse error:", err);
      await markCaptureFailed(userId, captureEventId, (err as Error).message);
      await ctx.reply(
        "⚠️ Could not extract expense details from this image. Is this a receipt or bill? Try a clearer photo.",
      );
      return;
    }
  }

  if (!parsed) {
    await markCaptureFailed(userId, captureEventId, "Receipt parser found no expense");
    await ctx.reply(
      "🤔 This doesn't look like a receipt or bill. If it is, try a clearer photo.\n\nFor manual entry, just type the amount and description.",
    );
    return;
  }

  // Per-merchant memory wins over the LLM's category guess when present.
  const learnedCategoryId = await getLearnedCategoryForMerchant(userId, parsed.merchant);
  const cat: { id: string; name: string } | null =
    (learnedCategoryId && cats.find((c) => c.id === learnedCategoryId)) ||
    cats.find((c) => c.name.toLowerCase() === parsed!.category.toLowerCase()) ||
    cats.find((c) => c.name === "Other") ||
    null;
  const amount_cents = Math.round(parsed.amount * 100);
  const occurred_at = new Date(parsed.occurred_at + "T12:00:00Z");
  const rule = await applySmartRules(userId, {
    merchant: parsed.merchant,
    description: parsed.description,
    rawText: ocrText,
  });
  const accountId = rule.account_id ?? (await guessAccountFromText(userId, ocrText));
  const categoryId = rule.category_id ?? cat?.id ?? null;
  const categoryName = cats.find((candidate) => candidate.id === categoryId)?.name ?? cat?.name ?? "Other";
  const confidence = buildCaptureConfidence({
    amountCents: amount_cents,
    occurredAt: occurred_at,
    merchant: parsed.merchant,
    description: parsed.description,
    categoryId,
    accountId,
    source: "receipt",
    ruleId: rule.rule_id,
    parser: "receipt_regex",
    amountQuality: parsed.amountQuality,
    rawText: ocrText,
  });

  let expenseId: string;
  try {
    expenseId = await insertExpense({
      userId,
      amount_cents,
      currency: parsed.currency,
      description: parsed.description,
      merchant: parsed.merchant,
      category_id: categoryId,
      occurred_at,
      source: "receipt",
      raw_text: ocrText,
      image_key: s3Key,
      content_hash: contentHash,
      review_status: rule.review_status ?? reviewStatusFromConfidence("needs_review", confidence),
      account_id: accountId,
      capture_event_id: captureEventId,
      confidence,
      paid_by_user_id: actorUserId(ctx),
      settlement_scope: userId < 0 ? "shared" : "personal",
      actorUserId: actorUserId(ctx),
    });
    for (const rawName of rule.tag_names) {
      const tagId = await getOrCreateTag(userId, rawName);
      if (tagId) await attachTagToExpense(expenseId, tagId);
    }
    await markCaptureProcessed(userId, captureEventId, expenseId, confidence);
  } catch (err) {
    await markCaptureFailed(userId, captureEventId, (err as Error).message);
    await ctx.reply(`❌ Failed to save expense: ${String(err)}`);
    return;
  }

  await setPendingEditForActor(ctx, userId, {
    expenseId,
    amount_cents,
    currency: parsed.currency,
    category: categoryName,
    description: parsed.description,
    occurred_at,
  });

  const merchantPart = parsed.merchant ? ` at ${parsed.merchant}` : "";
  await ctx.reply(
    `✅ Receipt logged: ${formatAmount(amount_cents, parsed.currency)}${merchantPart} — ${categoryName}\n` +
      `Date: ${parsed.occurred_at}\n\n` +
      `Reply \`category: <name>\` to change category, or use the buttons below.`,
    { parse_mode: "Markdown", reply_markup: editKeyboard(expenseId, userId) },
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
  const captureEventId = await recordCaptureEvent({
    userId,
    source: "telegram_voice",
    rawText: text,
    metadata: { telegram_file_id: voice.file_id, duration: voice.duration },
  });

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
    await markCaptureFailed(userId, captureEventId, (err as Error).message);
    await ctx.reply("⚠️ I had trouble parsing that voice note. Try a text message instead?");
    return;
  }

  if (classification.type === "query") {
    await markCaptureProcessed(userId, captureEventId, null);
    await handleQueryIntent(ctx, userId, classification.intent);
    return;
  }

  if (classification.type === "clarify") {
    await markCaptureProcessed(userId, captureEventId, null);
    await ctx.reply(classification.question);
    return;
  }

  if (classification.type !== "expense") {
    await markCaptureFailed(userId, captureEventId, "Voice note was not classified as an expense");
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
  const rule = await applySmartRules(userId, {
    merchant: parsed.merchant,
    description: parsed.description,
    rawText: text,
  });
  const accountId = rule.account_id ?? (await guessAccountFromText(userId, text));
  const categoryId = rule.category_id ?? cat?.id ?? null;
  const categoryName = cats.find((candidate) => candidate.id === categoryId)?.name ?? cat?.name ?? "Other";
  const confidence = buildCaptureConfidence({
    amountCents: amount_cents,
    occurredAt: occurred_at,
    merchant: parsed.merchant,
    description: parsed.description,
    categoryId,
    accountId,
    source: "telegram_voice",
    ruleId: rule.rule_id,
    parser: "voice",
    rawText: text,
  });

  const expenseId = await insertExpense({
    userId,
    amount_cents,
    currency: parsed.currency,
    description: parsed.description,
    merchant: parsed.merchant,
    category_id: categoryId,
    occurred_at,
    source: "telegram",
    raw_text: text,
    review_status: rule.review_status ?? reviewStatusFromConfidence(undefined, confidence),
    account_id: accountId,
    capture_event_id: captureEventId,
    confidence,
    paid_by_user_id: actorUserId(ctx),
    settlement_scope: userId < 0 ? "shared" : "personal",
    actorUserId: actorUserId(ctx),
  });
  for (const rawName of rule.tag_names) {
    const tagId = await getOrCreateTag(userId, rawName);
    if (tagId) await attachTagToExpense(expenseId, tagId);
  }
  await markCaptureProcessed(userId, captureEventId, expenseId, confidence);

  await setPendingEditForActor(ctx, userId, {
    expenseId,
    amount_cents,
    currency: parsed.currency,
    category: categoryName,
    description: parsed.description,
    occurred_at,
  });

  await ctx.reply(
    `✅ Logged: ${formatAmount(amount_cents, parsed.currency)} ${parsed.description} — ${categoryName}. Reply \`edit\` to change.`,
    { parse_mode: "Markdown", reply_markup: editKeyboard(expenseId, userId) },
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
async function sendPeriodExport(
  ctx: Context,
  userId: number,
  period: CommandPeriod,
): Promise<void> {
  await ctx.reply("📊 Generating export…");

  const { buffer, filename, rowCount, totalCents, currency } = await buildMonthlyXlsx(
    userId,
    period.start,
    period.end,
    period.rangeKey,
  );

  if (rowCount === 0) {
    await ctx.reply(`No expenses found for ${period.label}.`);
    return;
  }

  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption:
      `📊 ${period.label}\n` +
      `${rowCount} expense${rowCount !== 1 ? "s" : ""}, ` +
      `${formatAmount(totalCents, currency)}`,
  });
}

export async function handleExport(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const args = (ctx.match?.toString() ?? "").trim();
  const period = parseCommandPeriod(args);
  if (!period) {
    await ctx.reply(
      "Usage: `/export`, `/export last`, `/export 2026-04`, or `/export 2026-04-01 2026-04-30`",
      { parse_mode: "Markdown" },
    );
    return;
  }

  await sendPeriodExport(ctx, userId, period);
}
