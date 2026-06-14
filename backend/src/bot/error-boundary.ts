import type { Context, NextFunction } from "grammy";

/**
 * Global error boundary for the bot. Registered as the FIRST middleware so it
 * wraps every command, message, and callback handler.
 *
 * A thrown error is logged and turned into a friendly reply — it is NEVER
 * rethrown. Without this, grammy's default handler stops long-polling and the
 * error propagates out of `bot.start()`, which the entrypoint turns into a
 * `process.exit(1)`. Because the bot is a single long-poll client and pending
 * updates are not dropped, an input-shaped error (a malformed photo, a Markdown
 * parse failure, a transient DB blip) would otherwise become a deterministic
 * crash loop, re-processing the same bad update on every restart.
 */
function replyForError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("KHATA_MONTH_CLOSED")) {
    return "🔒 That month is closed, so it can't be changed. Reopen it from the dashboard first, then make your correction.";
  }
  return "⚠️ Something went wrong handling that. Please try again.";
}

export async function errorBoundary(ctx: Context, next: NextFunction): Promise<void> {
  try {
    await next();
  } catch (err) {
    console.error("[bot] unhandled handler error:", err);
    try {
      await ctx.reply(replyForError(err));
    } catch (replyErr) {
      // A failure sending the error reply (e.g. the chat is unreachable) must
      // not re-throw and defeat the whole point of the boundary.
      console.error("[bot] failed to send error reply:", replyErr);
    }
  }
}
