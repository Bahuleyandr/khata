import { Buffer } from "node:buffer";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  // 1. Store in S3 and create a statement record
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

  // 2. Parse
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

  // 3. Dedupe
  const results = await dedupeTransactions(userId, transactions);
  const alreadyLoggedCount = results.filter((r) => r.alreadyLogged).length;
  const newCount = results.length - alreadyLoggedCount;

  // 4. Offer confirmation
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

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    "👋 Hello! I'm your expense tracker bot.\n\n" +
      "Send me a message describing an expense (e.g. \"Coffee 150\") and I'll log it.\n" +
      "Upload a bank statement PDF or photo and I'll parse it automatically.",
  );
}

export async function handleTextMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Check for a pending import confirmation first
  const pending = getPendingImport(chatId);
  if (pending) {
    const lower = text.toLowerCase();
    if (lower === "yes" || lower === "y") {
      await ctx.reply("⏳ Importing…");
      try {
        const inserted = await bulkInsertTransactions(
          ctx.from!.id,
          pending.statementId,
          pending.results,
        );
        await updateStatementStatus(pending.statementId, "imported", pending.totalCount);
        clearPendingImport(chatId);
        await ctx.reply(`✅ Imported ${inserted} new transaction${inserted !== 1 ? "s" : ""}.`);
      } catch (err) {
        await updateStatementStatus(
          pending.statementId,
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
      await ctx.reply('Reply *yes* to import or *no* to cancel.', { parse_mode: "Markdown" });
    }
    return;
  }

  // Placeholder — natural-language expense parsing wired in a follow-up task
  await ctx.reply(`Got it! Expense parsing is coming soon. You said: "${text}"`);
}

export async function handleDocument(ctx: Context): Promise<void> {
  const doc = ctx.message?.document;
  if (!doc) {
    await ctx.reply("📄 Document received but I couldn't read it.");
    return;
  }

  const mimeType = doc.mime_type ?? "application/octet-stream";
  const supported = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];
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

  // Use the highest-resolution version
  const photo = photos[photos.length - 1]!;
  await runStatementPipeline(ctx, photo.file_id, "image/jpeg", "photo.jpg");
}
