import type { Context } from "grammy";

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    "👋 Hello! I'm your expense tracker bot.\n\n" +
      "Send me a message describing an expense (e.g. \"Coffee 150\") and I'll log it.\n" +
      "Upload a bank statement PDF and I'll parse it automatically.",
  );
}

export async function handleTextMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;
  // Placeholder — NL parsing will be wired here in a follow-up task
  await ctx.reply(`Got it! Expense parsing is coming soon. You said: "${text}"`);
}

export async function handleDocument(ctx: Context): Promise<void> {
  const doc = ctx.message?.document;
  await ctx.reply(
    doc
      ? `📄 Received: ${doc.file_name ?? "untitled"}. Statement import is coming soon.`
      : "📄 Document received. Statement import is coming soon.",
  );
}

export async function handlePhoto(ctx: Context): Promise<void> {
  await ctx.reply("📷 Got your photo. Receipt parsing is coming soon.");
}
