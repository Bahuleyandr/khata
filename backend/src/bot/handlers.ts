import type { Context } from "grammy";

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    "👋 Hello! I'm your expense tracker bot.\n\n" +
      "Send me a message describing an expense (e.g. \"Coffee 150\") and I'll log it.\n" +
      "Upload a bank statement PDF and I'll parse it automatically.",
  );
}

export async function handleTextMessage(ctx: Context): Promise<void> {
  // Placeholder — NL parsing will be wired here in a follow-up task
  await ctx.reply(
    "Got it! Expense parsing is coming soon. Message received: " +
      (ctx.message?.text ?? ""),
  );
}

export async function handleDocument(ctx: Context): Promise<void> {
  const doc = ctx.message?.document;
  if (!doc) return;
  await ctx.reply(
    `📄 Received document: ${doc.file_name ?? "untitled"}. Statement import is coming soon.`,
  );
}

export async function handlePhoto(ctx: Context): Promise<void> {
  await ctx.reply(
    "📷 Got your photo. Receipt parsing is coming soon.",
  );
}
