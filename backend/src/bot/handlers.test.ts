import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";

// Mock all modules that touch env vars or external services before importing handlers
vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "test-token",
    telegramWebhookSecret: "test-secret",
    allowedTelegramUserIds: [111111],
    databaseUrl: "postgres://test",
    anthropicApiKey: "test-anthropic-key",
    s3: {
      endpoint: "https://test.r2.dev",
      bucket: "test-bucket",
      region: "auto",
      accessKeyId: "key",
      secretAccessKey: "secret",
    },
  },
}));

vi.mock("../storage/index.js", () => ({
  uploadStatement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/index.js", () => ({
  sql: Object.assign(
    vi.fn().mockResolvedValue([{ id: "stmt-id-1" }]),
    { unsafe: vi.fn() },
  ),
}));

vi.mock("../statement/parser.js", () => ({
  parseStatementBuffer: vi.fn().mockResolvedValue([
    { date: "2024-01-15", description: "Starbucks", amountCents: 45000, currency: "INR", suggestedCategory: "Food" },
    { date: "2024-01-16", description: "Uber", amountCents: 25000, currency: "INR", suggestedCategory: "Transport" },
  ]),
}));

vi.mock("../statement/dedup.js", () => ({
  dedupeTransactions: vi.fn().mockResolvedValue([
    { transaction: { date: "2024-01-15", description: "Starbucks", amountCents: 45000, currency: "INR", suggestedCategory: "Food" }, alreadyLogged: false },
    { transaction: { date: "2024-01-16", description: "Uber", amountCents: 25000, currency: "INR", suggestedCategory: "Transport" }, alreadyLogged: true },
  ]),
}));

vi.mock("../statement/session.js", () => {
  const store = new Map<number, unknown>();
  return {
    setPendingImport: vi.fn((chatId: number, data: unknown) => store.set(chatId, data)),
    getPendingImport: vi.fn((chatId: number) => store.get(chatId)),
    clearPendingImport: vi.fn((chatId: number) => store.delete(chatId)),
    _store: store,
  };
});

vi.mock("../statement/importer.js", () => ({
  createStatementRecord: vi.fn().mockResolvedValue("stmt-id-1"),
  updateStatementStatus: vi.fn().mockResolvedValue(undefined),
  bulkInsertTransactions: vi.fn().mockResolvedValue(1),
}));

import { handleStart, handleTextMessage, handleDocument, handlePhoto } from "./handlers.js";
import { getPendingImport, setPendingImport, clearPendingImport } from "../statement/session.js";

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    message: undefined,
    from: { id: 111111 },
    chat: { id: 111111 },
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
  beforeEach(() => {
    vi.mocked(clearPendingImport)(111111);
  });

  it("replies with placeholder when no pending import", async () => {
    vi.mocked(getPendingImport).mockReturnValueOnce(undefined);
    const ctx = makeCtx({ message: { text: "Coffee 150" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Coffee 150");
  });

  it("asks for clarification on unrecognised reply during pending import", async () => {
    vi.mocked(getPendingImport).mockReturnValueOnce({
      statementId: "stmt-1",
      results: [],
      totalCount: 5,
      alreadyLoggedCount: 2,
      newCount: 3,
    });
    const ctx = makeCtx({ message: { text: "maybe" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("yes");
  });

  it("cancels import on 'no'", async () => {
    vi.mocked(getPendingImport).mockReturnValueOnce({
      statementId: "stmt-1",
      results: [],
      totalCount: 5,
      alreadyLoggedCount: 2,
      newCount: 3,
    });
    const ctx = makeCtx({ message: { text: "no" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(clearPendingImport).toHaveBeenCalledWith(111111);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("cancel");
  });

  it("does nothing when text is missing", async () => {
    const ctx = makeCtx({ message: {} as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("handleDocument", () => {
  it("rejects unsupported file types", async () => {
    const ctx = makeCtx({
      message: {
        document: { file_id: "abc", mime_type: "text/csv", file_name: "data.csv" },
      } as Context["message"],
    });
    await handleDocument(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Unsupported");
  });

  it("replies with fallback when document is absent", async () => {
    const ctx = makeCtx({ message: {} as Context["message"] });
    await handleDocument(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toBeTruthy();
  });
});

describe("handlePhoto", () => {
  it("replies with fallback when photos array is missing", async () => {
    const ctx = makeCtx({ message: {} as Context["message"] });
    await handlePhoto(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toBeTruthy();
  });
});
