import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";

// vi.hoisted lets us share state between the mock factory and test body.
const { importStore, editStore } = vi.hoisted(() => ({
  importStore: new Map<number, unknown>(),
  editStore: new Map<number, unknown>(),
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

vi.mock("./session.js", () => ({
  getPendingEdit: vi.fn((userId: number) => editStore.get(userId)),
  setPendingEdit: vi.fn((userId: number, data: unknown) => { editStore.set(userId, data); }),
  clearPendingEdit: vi.fn((userId: number) => { editStore.delete(userId); }),
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
  getExpenseForEdit: vi.fn().mockResolvedValue({
    id: "exp-1",
    amount_cents: 4500,
    currency: "INR",
    description: "lunch",
    category: "Food",
    occurred_at: new Date("2026-04-27T12:00:00Z"),
  }),
  updateExpenseAmount: vi.fn().mockResolvedValue(true),
  updateExpenseCategory: vi.fn().mockResolvedValue(true),
  updateExpenseDate: vi.fn().mockResolvedValue(true),
  deleteExpense: vi.fn().mockResolvedValue({
    id: "exp-1",
    amount_cents: "4500",
    currency: "INR",
    description: "lunch",
    merchant: null,
    merchant_canonical_id: null,
    category_id: "cat-food",
    source: "telegram",
    occurred_at: new Date("2026-04-27T12:00:00Z"),
    image_key: null,
    review_status: "reviewed",
  }),
  findExpenseByContentHash: vi.fn().mockResolvedValue(null),
  findExpenseByUpiRef: vi.fn().mockResolvedValue(null),
  attachReceiptToExpense: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db/audit.js", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/access.js", () => ({
  resolveLedgerForTelegramUser: vi.fn(({ requestedLedgerId }: { requestedLedgerId?: number }) =>
    Promise.resolve({ ledgerId: requestedLedgerId ?? 111111 }),
  ),
}));

vi.mock("../receipt/ocr.js", () => ({
  ocrReceiptImage: vi
    .fn()
    .mockResolvedValue("STARBUCKS\nDate: 27 Apr 2026\nCaffe Latte ₹250\nTotal: ₹250"),
}));

vi.mock("../db/overrides.js", () => ({
  getOverrides: vi.fn().mockResolvedValue([]),
  upsertOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../voice/transcribe.js", () => ({
  transcribeVoice: vi.fn().mockResolvedValue("(stub transcription)"),
}));

vi.mock("../ai/chat.js", () => ({
  chatWithData: vi.fn().mockResolvedValue({
    text: "(stub answer)",
    toolsUsed: [],
    iterations: 1,
  }),
}));

vi.mock("../ai/parse.js", () => ({
  parseExpense: vi.fn().mockResolvedValue({
    amount: 250,
    currency: "INR",
    description: "Caffe Latte",
    merchant: "Starbucks",
    occurred_at: "2026-04-27",
    category: "Food",
  }),
  classifyMessage: vi.fn().mockResolvedValue({
    type: "expense",
    data: {
      amount: 45,
      currency: "INR",
      description: "lunch",
      merchant: null,
      occurred_at: "2026-04-27",
      category: "Food",
    },
  }),
}));

vi.mock("../db/budgets.js", () => ({
  setBudget: vi.fn().mockResolvedValue(undefined),
  listBudgets: vi.fn().mockResolvedValue([
    { id: "budget-1", category_id: "cat-food", category_name: "Food", target_cents: 500000, period: "monthly" },
  ]),
  clearBudget: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db/query.js", () => ({
  totalSpendInCategory: vi.fn().mockResolvedValue([
    { total_cents: "452300", currency: "INR", count: 12 },
  ]),
  topExpenses: vi.fn().mockResolvedValue([
    {
      id: "exp-1",
      description: "Swiggy order",
      merchant: "Swiggy",
      occurred_at: new Date("2026-04-23T12:00:00Z"),
      amount_cents: "120000",
      currency: "INR",
      category: "Food",
    },
    {
      id: "exp-2",
      description: "Ola ride",
      merchant: "Ola",
      occurred_at: new Date("2026-04-20T12:00:00Z"),
      amount_cents: "89000",
      currency: "INR",
      category: "Transport",
    },
  ]),
  spendByCategory: vi.fn().mockResolvedValue([
    { category: "Food", total_cents: "452300", currency: "INR", count: 12 },
    { category: "Transport", total_cents: "210000", currency: "INR", count: 5 },
  ]),
}));

import {
  handleStart,
  handleHelp,
  handleCategories,
  handleAddCategory,
  handleRenameCategory,
  handleDeleteCategory,
  handleBudget,
  handleTextMessage,
  handleCallbackQuery,
  handleDocument,
  handlePhoto,
} from "./handlers.js";
import { clearPendingImport } from "../statement/session.js";
import * as mockAI from "../ai/parse.js";
import * as mockQuery from "../db/query.js";
import * as mockExpenses from "../db/expenses.js";
import * as mockOcr from "../receipt/ocr.js";
import * as mockBudgets from "../db/budgets.js";
import * as mockAudit from "../db/audit.js";

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
  editStore.clear();
  importStore.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  // Restore default mocks after clearAllMocks wipes mockReturnValueOnce queues
  vi.mocked(mockExpenses.getExpenseForEdit).mockResolvedValue({
    id: "exp-1",
    amount_cents: 4500,
    currency: "INR",
    description: "lunch",
    category: "Food",
    occurred_at: new Date("2026-04-27T12:00:00Z"),
  });
  vi.mocked(mockExpenses.deleteExpense).mockResolvedValue({
    id: "exp-1",
    amount_cents: "4500",
    currency: "INR",
    description: "lunch",
    merchant: null,
    merchant_canonical_id: null,
    category_id: "cat-food",
    source: "telegram",
    occurred_at: new Date("2026-04-27T12:00:00Z"),
    image_key: null,
    review_status: "reviewed",
  });
  vi.mocked(mockExpenses.findExpenseByContentHash).mockResolvedValue(null);
  vi.mocked(mockOcr.ocrReceiptImage).mockResolvedValue(
    "STARBUCKS\nDate: 27 Apr 2026\nCaffe Latte ₹250\nTotal: ₹250",
  );
  vi.mocked(mockAI.parseExpense).mockResolvedValue({
    amount: 250,
    currency: "INR",
    description: "Caffe Latte",
    merchant: "Starbucks",
    occurred_at: "2026-04-27",
    category: "Food",
  });
  vi.mocked(mockAI.classifyMessage).mockResolvedValue({
    type: "expense",
    data: {
      amount: 45,
      currency: "INR",
      description: "lunch",
      merchant: null,
      occurred_at: "2026-04-27",
      category: "Food",
    },
  });
  vi.mocked(mockQuery.totalSpendInCategory).mockResolvedValue([
    { total_cents: "452300", currency: "INR", count: 12 },
  ]);
  vi.mocked(mockQuery.topExpenses).mockResolvedValue([
    {
      id: "exp-1",
      description: "Swiggy order",
      merchant: "Swiggy",
      occurred_at: new Date("2026-04-23T12:00:00Z"),
      amount_cents: "120000",
      currency: "INR",
      category: "Food",
    },
    {
      id: "exp-2",
      description: "Ola ride",
      merchant: "Ola",
      occurred_at: new Date("2026-04-20T12:00:00Z"),
      amount_cents: "89000",
      currency: "INR",
      category: "Transport",
    },
  ]);
  vi.mocked(mockQuery.spendByCategory).mockResolvedValue([
    { category: "Food", total_cents: "452300", currency: "INR", count: 12 },
    { category: "Transport", total_cents: "210000", currency: "INR", count: 5 },
  ]);
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
    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup?: unknown },
    ];
    expect(JSON.stringify(options.reply_markup)).toContain("Delete Entry");
    expect(editStore.has(111111)).toBe(true);
  });

  it("logs AMEX card spend alerts through the payment fast path", async () => {
    const text =
      "Alert: You've spent INR 19,900.00 on your AMEX card ** 31009 at OPENAI OPCO on 28 April 2026 at 10:58 AM IST. Call 18004190691 if this was not made by you.";
    const ctx = makeCtx({ message: { text } as Context["message"] });
    await handleTextMessage(ctx);
    expect(vi.mocked(mockAI.classifyMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(mockExpenses.insertExpense)).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 1990000,
        currency: "INR",
        description: "OPENAI OPCO",
        merchant: "OPENAI OPCO",
        source: "telegram",
        raw_text: text,
      }),
    );
    const payload = vi.mocked(mockExpenses.insertExpense).mock.calls[0]![0] as {
      occurred_at: Date;
    };
    expect(payload.occurred_at.toISOString().slice(0, 10)).toBe("2026-04-28");
    const [reply] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(reply).toContain("Payment logged");
    expect(reply).toContain("OPENAI OPCO");
    expect(reply).toContain("_via AmEx_");
  });

  it("logs the exact AMEX PAYU SWIGGY alert through the payment fast path", async () => {
    const text =
      "Alert: You've spent INR 301.00 on your AMEX card ** 31009 at PAYU SWIGGY on 29 April 2026 at 12:56 PM IST. Call 18004190691 if this was not made by you.";
    const ctx = makeCtx({ message: { text } as Context["message"] });
    await handleTextMessage(ctx);
    expect(vi.mocked(mockAI.classifyMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(mockExpenses.insertExpense)).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 30100,
        currency: "INR",
        description: "PAYU SWIGGY",
        merchant: "PAYU SWIGGY",
        source: "telegram",
        raw_text: text,
      }),
    );
    const payload = vi.mocked(mockExpenses.insertExpense).mock.calls[0]![0] as {
      occurred_at: Date;
    };
    expect(payload.occurred_at.toISOString().slice(0, 10)).toBe("2026-04-29");
    const [reply] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(reply).toContain("Payment logged");
    expect(reply).toContain("PAYU SWIGGY");
    expect(reply).toContain("_via AmEx_");
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
    editStore.set(111111, {
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
    editStore.set(111111, {
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
    editStore.set(111111, {
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

  it("replies with friendly message when AI returns unknown classification", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({ type: "unknown" });
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

// ── Query intent handler ──────────────────────────────────────────────────────

describe("handleTextMessage — query intent", () => {
  it("returns total spend for a category query", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({
      type: "query",
      intent: {
        category: "Food",
        time_range_label: "this month",
        start_date: "2026-04-01",
        end_date: "2026-04-27",
      },
    });
    const ctx = makeCtx({
      message: { text: "how much on food this month?" } as Context["message"],
    });
    await handleTextMessage(ctx);
    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Food");
    expect(text).toContain("this month");
    expect(text).toContain("4,523");
  });

  it("returns total spend across all categories when no category given", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({
      type: "query",
      intent: {
        time_range_label: "this month",
        start_date: "2026-04-01",
        end_date: "2026-04-27",
      },
    });
    const ctx = makeCtx({
      message: { text: "how much did I spend this month?" } as Context["message"],
    });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("this month");
    expect(text).toContain("4,523");
  });

  it("returns top N expenses when top_n is set", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({
      type: "query",
      intent: {
        time_range_label: "last week",
        start_date: "2026-04-21",
        end_date: "2026-04-27",
        top_n: 5,
      },
    });
    const ctx = makeCtx({
      message: { text: "top 5 expenses last week" } as Context["message"],
    });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Top");
    expect(text).toContain("Swiggy");
    expect(text).toContain("last week");
  });

  it("returns category breakdown when group_by_category is set", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({
      type: "query",
      intent: {
        time_range_label: "this month",
        start_date: "2026-04-01",
        end_date: "2026-04-27",
        group_by_category: true,
      },
    });
    const ctx = makeCtx({
      message: { text: "show spending by category this month" } as Context["message"],
    });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Food");
    expect(text).toContain("Transport");
    expect(text).toContain("this month");
    expect(text).toContain("Total");
  });

  it("replies with clarification question when AI returns clarify type", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({
      type: "clarify",
      question: "Which month did you mean?",
    });
    const ctx = makeCtx({
      message: { text: "how much did I spend?" } as Context["message"],
    });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Which month");
  });

  it("replies 'no expenses found' when query returns empty rows", async () => {
    vi.mocked(mockAI.classifyMessage).mockResolvedValueOnce({
      type: "query",
      intent: {
        category: "Entertainment",
        time_range_label: "last year",
        start_date: "2025-01-01",
        end_date: "2025-12-31",
      },
    });
    vi.mocked(mockQuery.totalSpendInCategory).mockResolvedValueOnce([]);
    const ctx = makeCtx({
      message: { text: "how much on entertainment last year?" } as Context["message"],
    });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("no expenses");
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
    editStore.set(111111, {
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
    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup?: unknown },
    ];
    expect(JSON.stringify(options.reply_markup)).toContain("Back");
    expect((editStore.get(111111) as { waitingFor?: string } | undefined)?.waitingFor).toBe("amount");
  });

  it("prompts for date on editdt callback", async () => {
    editStore.set(111111, {
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
    expect((editStore.get(111111) as { waitingFor?: string } | undefined)?.waitingFor).toBe("date");
  });

  it("adds a back option to the category picker", async () => {
    editStore.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
    });
    const ctx = makeCtx({ callbackQuery: { data: "editcat:exp-1" } } as Partial<Context>);
    await handleCallbackQuery(ctx);
    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup?: unknown },
    ];
    expect(text).toContain("Select new category");
    expect(JSON.stringify(options.reply_markup)).toContain("Back");
  });

  it("goes back to edit options without changing the pending edit", async () => {
    editStore.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
      waitingFor: "amount",
    });
    const ctx = makeCtx({ callbackQuery: { data: "backedit:exp-1" } } as Partial<Context>);
    await handleCallbackQuery(ctx);
    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup?: unknown },
    ];
    expect(text).toContain("No changes made");
    expect(JSON.stringify(options.reply_markup)).toContain("Change Category");
    expect(JSON.stringify(options.reply_markup)).toContain("Delete Entry");
    expect((editStore.get(111111) as { waitingFor?: string } | undefined)?.waitingFor).toBeUndefined();
  });

  it("asks for confirmation before deleting an expense", async () => {
    const ctx = makeCtx({ callbackQuery: { data: "delexp:exp-1" } } as Partial<Context>);
    await handleCallbackQuery(ctx);
    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup?: unknown },
    ];
    expect(text).toContain("Delete this entry");
    expect(JSON.stringify(options.reply_markup)).toContain("Delete Entry");
    expect(JSON.stringify(options.reply_markup)).toContain("Back");
    expect(vi.mocked(mockExpenses.deleteExpense)).not.toHaveBeenCalled();
  });

  it("deletes an expense after confirmation and records audit history", async () => {
    editStore.set(111111, {
      expenseId: "exp-1",
      amount_cents: 4500,
      currency: "INR",
      category: "Food",
      description: "lunch",
      occurred_at: new Date(),
    });
    const ctx = makeCtx({ callbackQuery: { data: "confirmdel:exp-1" } } as Partial<Context>);
    await handleCallbackQuery(ctx);
    expect(vi.mocked(mockExpenses.deleteExpense)).toHaveBeenCalledWith("exp-1", 111111);
    expect(vi.mocked(mockAudit.recordAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 111111,
        actorUserId: 111111,
        action: "expense.delete",
        entityType: "expense",
        entityId: "exp-1",
        metadata: { source: "telegram" },
      }),
    );
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Entry deleted");
    expect(editStore.has(111111)).toBe(false);
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

// ── Receipt OCR pipeline ──────────────────────────────────────────────────────

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { file_path: "photos/file.jpg" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: { get: () => "image/jpeg" },
      }),
  );
}

describe("handlePhoto — receipt pipeline", () => {
  it("logs a receipt expense and replies with a summary containing the amount and category", async () => {
    stubFetch();
    const ctx = makeCtx({
      message: {
        photo: [{ file_id: "photo-id-1", width: 1280, height: 960, file_size: 98304 }],
      } as Context["message"],
    });
    await handlePhoto(ctx);
    expect(vi.mocked(mockExpenses.insertExpense)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "receipt", content_hash: expect.any(String) }),
    );
    const lastReply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
    expect(lastReply).toContain("Receipt logged");
    expect(lastReply).toContain("Food");
    expect(editStore.has(111111)).toBe(true);
  });

  it("logs an IMPS payment confirmation screenshot through the receipt fast path", async () => {
    stubFetch();
    const ocrText = [
      "GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT",
      "₹73,386",
      "Apartment 1A",
      "Request Accepted | Apr 29, 2026",
      "Transaction Summary",
      "Paid To : GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT",
      "Indian Overseas Bank",
      "Savings A/c: 209601000001470",
      "Paid By : DR T SUBASH CHANDHAR",
      "Payment Method",
      "Bank Transfer | IMPS",
      "HDFC Transaction ID",
      "HDFCDF529F4E338E",
      "Reference Number",
      "611954154961",
    ].join("\n");
    vi.mocked(mockOcr.ocrReceiptImage).mockResolvedValueOnce(ocrText);
    const ctx = makeCtx({
      message: {
        photo: [{ file_id: "photo-id-1", width: 1280, height: 960, file_size: 98304 }],
      } as Context["message"],
    });
    await handlePhoto(ctx);
    expect(vi.mocked(mockAI.parseExpense)).not.toHaveBeenCalled();
    expect(vi.mocked(mockExpenses.insertExpense)).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 7338600,
        currency: "INR",
        description: "GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT",
        merchant: "GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT",
        source: "receipt",
        raw_text: ocrText,
        upi_reference_id: "611954154961",
        review_status: "needs_review",
        image_key: expect.stringMatching(/^receipts\/111111\//),
        content_hash: expect.any(String),
      }),
    );
    const payload = vi.mocked(mockExpenses.insertExpense).mock.calls[0]![0] as {
      occurred_at: Date;
    };
    expect(payload.occurred_at.toISOString().slice(0, 10)).toBe("2026-04-29");
    const lastReply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
    expect(lastReply).toContain("Receipt logged");
    expect(lastReply).toContain("GEE GEE MINAR");
  });

  it("skips duplicate image and does not insert an expense", async () => {
    vi.mocked(mockExpenses.findExpenseByContentHash).mockResolvedValueOnce("existing-expense-id");
    stubFetch();
    const ctx = makeCtx({
      message: {
        photo: [{ file_id: "photo-id-1", width: 1280, height: 960 }],
      } as Context["message"],
    });
    await handlePhoto(ctx);
    const lastReply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
    expect(lastReply).toContain("already logged");
    expect(vi.mocked(mockExpenses.insertExpense)).not.toHaveBeenCalled();
  });

  it("replies gracefully when OCR fails", async () => {
    stubFetch();
    vi.mocked(mockOcr.ocrReceiptImage).mockRejectedValueOnce(new Error("Claude API timeout"));
    const ctx = makeCtx({
      message: {
        photo: [{ file_id: "photo-id-1", width: 1280, height: 960 }],
      } as Context["message"],
    });
    await handlePhoto(ctx);
    const lastReply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
    expect(lastReply).toContain("OCR failed");
    expect(vi.mocked(mockExpenses.insertExpense)).not.toHaveBeenCalled();
  });

  it("replies gracefully when image is not a receipt", async () => {
    stubFetch();
    vi.mocked(mockAI.parseExpense).mockResolvedValueOnce(null);
    const ctx = makeCtx({
      message: {
        photo: [{ file_id: "photo-id-1", width: 1280, height: 960 }],
      } as Context["message"],
    });
    await handlePhoto(ctx);
    const lastReply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
    expect(lastReply).toContain("doesn't look like a receipt");
    expect(vi.mocked(mockExpenses.insertExpense)).not.toHaveBeenCalled();
  });
});

// ── "category: X" quick correction ───────────────────────────────────────────

describe("handleTextMessage — category: shortcut", () => {
  it("updates category when a pending expense exists", async () => {
    editStore.set(111111, {
      expenseId: "exp-receipt-1",
      amount_cents: 25000,
      currency: "INR",
      category: "Food",
      description: "caffe latte",
      occurred_at: new Date(),
    });
    const ctx = makeCtx({ message: { text: "category: Transport" } as Context["message"] });
    await handleTextMessage(ctx);
    expect(vi.mocked(mockExpenses.updateExpenseCategory)).toHaveBeenCalledWith(
      "exp-receipt-1",
      111111,
      "cat-food",
    );
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("updated");
  });

  it("replies with 'no recent expense' when no pending edit exists", async () => {
    const ctx = makeCtx({ message: { text: "category: Groceries" } as Context["message"] });
    await handleTextMessage(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("no recent expense");
  });
});

describe("handleBudget", () => {
  it("lists budgets with /budget list", async () => {
    const ctx = makeCtx({ message: { text: "/budget list" } as Context["message"] });
    await handleBudget(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Food");
    expect(text).toContain("₹");
  });

  it("shows empty message when no budgets", async () => {
    vi.mocked(mockBudgets.listBudgets).mockResolvedValueOnce([]);
    const ctx = makeCtx({ message: { text: "/budget" } as Context["message"] });
    await handleBudget(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("no budgets");
  });

  it("sets a budget with /budget set Food 5000", async () => {
    const ctx = makeCtx({ message: { text: "/budget set Food 5000" } as Context["message"] });
    await handleBudget(ctx);
    expect(vi.mocked(mockBudgets.setBudget)).toHaveBeenCalledWith(111111, "cat-food", 500000);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Food");
  });

  it("rejects unknown category in /budget set", async () => {
    vi.mocked((await import("../db/categories.js")).getCategoryByName).mockResolvedValueOnce(null);
    const ctx = makeCtx({ message: { text: "/budget set Nonexistent 100" } as Context["message"] });
    await handleBudget(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("not found");
  });

  it("clears a budget with /budget clear Food", async () => {
    const ctx = makeCtx({ message: { text: "/budget clear Food" } as Context["message"] });
    await handleBudget(ctx);
    expect(vi.mocked(mockBudgets.clearBudget)).toHaveBeenCalledWith(111111, "cat-food");
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("cleared");
  });

  it("shows usage help on unrecognised subcommand", async () => {
    const ctx = makeCtx({ message: { text: "/budget foo bar" } as Context["message"] });
    await handleBudget(ctx);
    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text.toLowerCase()).toContain("budget set");
  });
});
