import { describe, it, expect, vi } from "vitest";
import { handleStart, handleTextMessage, handleDocument, handlePhoto } from "./handlers.js";
import type { Context } from "grammy";

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    message: undefined,
    from: undefined,
    ...overrides,
  } as unknown as Context;
}

describe("handleStart", () => {
  it("replies with a greeting message", async () => {
    const ctx = makeCtx();
    await handleStart(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("expense tracker bot");
  });
});

describe("handleTextMessage", () => {
  it("echoes received text back", async () => {
    const ctx = makeCtx({ message: { text: "Coffee 150" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Coffee 150");
  });

  it("handles missing text gracefully", async () => {
    const ctx = makeCtx({ message: {} as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
  });
});

describe("handleDocument", () => {
  it("replies with document name when present", async () => {
    const ctx = makeCtx({
      message: {
        document: { file_name: "statement.pdf" },
      } as Context["message"],
    });
    await handleDocument(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("statement.pdf");
  });

  it("does nothing when document is absent", async () => {
    const ctx = makeCtx({ message: {} as Context["message"] });
    await handleDocument(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("handlePhoto", () => {
  it("replies with receipt parsing placeholder", async () => {
    const ctx = makeCtx();
    await handlePhoto(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("photo");
  });
});
