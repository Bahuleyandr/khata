import { describe, it, expect, vi } from "vitest";
import type { Context } from "grammy";
import { errorBoundary } from "./error-boundary.js";

function fakeCtx() {
  return { reply: vi.fn().mockResolvedValue(undefined) } as unknown as Context & {
    reply: ReturnType<typeof vi.fn>;
  };
}

describe("errorBoundary", () => {
  it("passes through when the handler succeeds and sends no error reply", async () => {
    const ctx = fakeCtx();
    const next = vi.fn().mockResolvedValue(undefined);

    await errorBoundary(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("swallows a thrown handler error and replies instead of propagating", async () => {
    const ctx = fakeCtx();
    const next = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(errorBoundary(ctx, next)).resolves.toBeUndefined();

    expect(ctx.reply).toHaveBeenCalledOnce();
  });

  it("still resolves even if sending the error reply itself throws", async () => {
    const ctx = {
      reply: vi.fn().mockRejectedValue(new Error("can't parse entities")),
    } as unknown as Context;
    const next = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(errorBoundary(ctx, next)).resolves.toBeUndefined();
  });
});
