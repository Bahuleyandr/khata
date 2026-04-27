import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";

// vi.hoisted lets us share state between the mock factory and test body.
const { importStore } = vi.hoisted(() => ({
  importStore: new Map<number, unknown>(),
}));

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
  sql: Object.assign(vi.fn().mockResolvedValue([{ id: "stmt-id-1" }]), { unsafe: vi.fn() }),
}));

vi.mock("../statement/parser.js", () => ({
  parseStatementBuffer: vi.fn().mockResolvedValue([
    {
      date: "2024-01-15",
      description: "Starbucks",
      amountCents: 45000,
      currency: "INR",
      suggestedCategory: "Food",
    },
  ]),
}));

vi.mock("../statement/dedup.js", () => ({
  dedupeTransactions: vi.fn().mockResolvedValue([
    {
      transaction: {
        date: "2024-01-15",
        description: "Starbucks",
        amountCents: 45000,
        currency: "INR",
        suggestedCategory: "Food",
      },
      alreadyLogged: false,
    },
  ]),
}));

vi.mock("../statement/session.js", () => ({
  setPendingImport: vi.fn((chatId: number, data: unknown) => importStore.set(chatId, data)),
  getPendingImport: vi.fn((chatId: number) => importStore.get(chatId)),
  clearPendingImport: vi.fn((chatId: number) => importStore.delete(chatId)),
}));

vi.mock("../statement/importer.js", () => ({
  createStatementRecord: vi.fn().mockResolvedValue("stmt-id-1"),
  updateStatementStatus: vi.fn().mockResolvedValue(undefined),
  bulkInsertTransactions: vi.fn().mockResolvedValue(1),
}));

vi.mock("../db/categories.js", () => ({
  seedDefaultCategories: vi.fn().mockResolvedValue(undefined),
  getUserCategories: vi.fn().mockResolvedValue([
    { id: "cat-food", name: "Food" },
    { id: "cat-transport", name: "Transport" },
    { id: "cat-other", name: "Other" },
  ]),
  getCategoryByName: vi.fn().mockResolvedValue({ id: "cat-food", name: "Food" }),
  renameCategory: vi.fn().mockResolvedValue(true),
  addCategory: vi.fn().mockResolvedValue(true),
  deleteCategory: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db/expenses.js", () => ({
  insertExpense: vi.fn().mockResolvedValue("expense-uuid-1"),
  updateExpenseAmount: vi.fn().mockResolvedValue(true),
  updateExpenseCategory: vi.fn().mockResolvedValue(true),
  updateExpenseDate: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db/overrides.js", () => ({
  getOverrides: vi.fn().mockResolvedValue([]),
  upsertOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ai/parse.js", () => ({
  parseExpense: vi.fn().mockResolvedValue({
    amount: 45,
    currency: "INR",
    description: "lunch",
    merchant: null,
    occurred_at: "2026-04-27",
    category: "Food",
  }),
}));

import {
  handleStart,
  handleHelp,
  handleCategories,
  handleAddCategory,
  handleRenameCategory,
  handleDeleteCategory,
  handleTextMessage,
  handleCallbackQuery,
  handleDocument,
  handlePhoto,
} from "./handlers.js";
import { pendingEdits } from "./session.js";
import { clearPendingImport } from "../statement/session.js";
import * as mockAI from "../ai/parse.js";

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    message: undefined,
    from: { id: 111111 },
    chat: { id: 111111 },
    callbackQuery: undefined,
    ...overrides,
  } as unknown as Context;
}

beforeEach(() => {
  pendingEdits.clear();
  importStore.clear();
  vi.clearAllMocks();
  // Restore default AI parse mock (clearAllMocks wipes mockReturnValueOnce queues only)
  vi.mocked(mockAI.parseExpense).mockResolvedValue({
    amount: 45,
    currency: "INR",
    description: "lunch",
    merchant: null,
    occurred_at: "2026-04-27",
    category: "Food",
  });
});

// ── Start / Help ──────────────────────────────────────────────────────────────

describe("handleStart", () => {
  it("replies with a greeting containing 'expense tracker bot'", async () => {
    const ctx = makeCtx();
    await handleStart(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("expense tracker bot");
  });
});

describe("handleHelp", () => {
  it("replies with help text containing commands", async () => {
    const ctx = makeCtx();
    await handleHelp(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("/categories");
    expect(text).toContain("/add");
  });
});

// ── Category commands ─────────────────────────────────────────────────────────

describe("handleCategories", () => {
  it("lists the user's categories", async () => {
    const ctx = makeCtx();
    await handleCategories(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Food");
    expect(text).toContain("Transport");
  });
});

describe("handleAddCategory", () => {
  it("adds a new category", async () => {
    const ctx = makeCtx({ message: { text: "/add Dining" } as Context["message"] });
    await handleAddCategory(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Added");
    expect(text).toContain("Dining");
  });

  it("shows usage when name is missing", async () => {
    const ctx = makeCtx({ message: { text: "/add" } as Context["message"] });
    await handleAddCategory(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Usage");
  });
});

describe("handleRenameCategory", () => {
  it("renames a category", async () => {
    const ctx = makeCtx({ message: { text: "/rename Food Dining" } as Context["message"] });
    await handleRenameCategory(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Renamed");
  });
});

describe("handleDeleteCategory", () => {
  it("deletes a category", async () => {
    const ctx = makeCtx({ message: { text: "/delete MyCategory" } as Context["message"] });
    await handleDeleteCategory(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Deleted");
  });
});

// ── Text message handler ──────────────────────────────────────────────────────

describe("handleTextMessage", () => {
  it("parses and logs an expense, replies with confirmation", async () => {
    const ctx = makeCtx({ message: { text: "$45 lunch w/ Anu" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Logged");
    expect(text).toContain("Food");
    expect(pendingEdits.has(111111)).toBe(true);
  });

  it("does nothing when text is missing", async () => {
    const ctx = makeCtx({ message: {} as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("skips command messages", async () => {
    const ctx = makeCtx({ message: { text: "/categories" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("shows nothing-to-edit when user types 'edit' with no pending expense", async () => {
    const ctx = makeCtx({ message: { text: "edit" } as Context["message"] });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Nothing to edit");
  });

  it("shows edit keyboard when user types 'edit' after logging", async () => {
    pendingEdits.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
    });
    const ctx = makeCtx({ message: { text: "edit" } as Context["message"] });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Editing");
    expect(text).toContain("Food");
  });

  it("handles amount edit follow-up", async () => {
    pendingEdits.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
      waitingFor: "amount",
    });
    const ctx = makeCtx({ message: { text: "200" } as Context["message"] });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Updated");
    expect(text).toContain("200");
  });

  it("handles date edit follow-up", async () => {
    pendingEdits.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
      waitingFor: "date",
    });
    const ctx = makeCtx({ message: { text: "2026-04-26" } as Context["message"] });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("2026-04-26");
  });

  it("replies with friendly message when AI returns null", async () => {
    vi.mocked(mockAI.parseExpense).mockResolvedValueOnce(null);
    const ctx = makeCtx({
      message: { text: "hello world not an expense" } as Context["message"],
    });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("doesn't look like an expense");
  });

  it("asks for clarification on unrecognised reply during pending import", async () => {
    importStore.set(111111, {
      statementId: "stmt-1",
      results: [],
      totalCount: 5,
      alreadyLoggedCount: 2,
      newCount: 3,
    });
    const ctx = makeCtx({ message: { text: "maybe" } as Context["message"] });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("yes");
  });

  it("cancels import on 'no'", async () => {
    importStore.set(111111, {
      statementId: "stmt-1",
      results: [],
      totalCount: 5,
      alreadyLoggedCount: 2,
      newCount: 3,
    });
    const ctx = makeCtx({ message: { text: "no" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(vi.mocked(clearPendingImport)).toHaveBeenCalledWith(111111);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("cancel");
  });
});

// ── Callback query handler ────────────────────────────────────────────────────

describe("handleCallbackQuery", () => {
  it("answers callback query without data gracefully", async () => {
    const ctx = makeCtx({ callbackQuery: {} } as Partial<Context>);
    await handleCallbackQuery(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it("prompts for amount on editamt callback", async () => {
    pendingEdits.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
    });
    const ctx = makeCtx({ callbackQuery: { data: "editamt:exp-1" } } as Partial<Context>);
    await handleCallbackQuery(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("amount");
    expect(pendingEdits.get(111111)?.waitingFor).toBe("amount");
  });

  it("prompts for date on editdt callback", async () => {
    pendingEdits.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
    });
    const ctx = makeCtx({ callbackQuery: { data: "editdt:exp-1" } } as Partial<Context>);
    await handleCallbackQuery(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("date");
    expect(pendingEdits.get(111111)?.waitingFor).toBe("date");
  });
});

// ── Document / Photo ──────────────────────────────────────────────────────────

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
