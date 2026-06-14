/**
 * Unit tests for the expenses PATCH route optimistic-locking (409) branch.
 * Follows the pattern established in hardening.test.ts: Fastify inject with
 * mocked sql/session/dependencies, no real database.
 */

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const sqlMock = vi.hoisted(() => Object.assign(vi.fn(), { begin: vi.fn() }));
const merchantMocks = vi.hoisted(() => ({
  getOrCreateMerchantCanonical: vi.fn(),
  setMerchantCategory: vi.fn(),
}));
const accountMocks = vi.hoisted(() => ({
  accountBelongsToUser: vi.fn(),
  guessAccountFromText: vi.fn(),
}));
const accessMocks = vi.hoisted(() => ({
  isActiveLedgerMember: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({
  recordAuditEvent: vi.fn(),
}));
const smartRuleMocks = vi.hoisted(() => ({
  applySmartRules: vi.fn(),
}));
const tagMocks = vi.hoisted(() => ({
  getOrCreateTag: vi.fn(),
  attachTagToExpense: vi.fn(),
  getTagsForExpenses: vi.fn(),
}));
const ruleSuggestionMocks = vi.hoisted(() => ({
  suggestionPatternFromText: vi.fn(),
  upsertRuleSuggestion: vi.fn(),
}));
const budgetMocks = vi.hoisted(() => ({
  getBudgetsWithMtd: vi.fn(),
}));
const queryMocks = vi.hoisted(() => ({
  findSubscriptionCandidates: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({
  uploadStatement: vi.fn(),
}));
const timeMocks = vi.hoisted(() => ({
  nowIstParts: vi.fn(),
}));
const xlsxMocks = vi.hoisted(() => ({
  currentMonthBounds: vi.fn(),
}));
const confidenceMocks = vi.hoisted(() => ({
  buildCaptureConfidence: vi.fn(),
  reviewStatusFromConfidence: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "123456:ABCdef-test",
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [12345],
    allowedOrigins: ["http://localhost:3000"],
    databaseUrl: "postgres://unused",
    s3: {
      endpoint: "http://s3.test",
      bucket: "khata-test",
      region: "us-east-1",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
  },
}));

vi.mock("../db/index.js", () => ({ sql: sqlMock }));
vi.mock("../db/merchants.js", () => merchantMocks);
vi.mock("../db/accounts.js", () => accountMocks);
vi.mock("../db/access.js", () => accessMocks);
vi.mock("../db/audit.js", () => auditMocks);
vi.mock("../db/smart-rules.js", () => smartRuleMocks);
vi.mock("../db/tags.js", () => tagMocks);
vi.mock("../db/rule-suggestions.js", () => ruleSuggestionMocks);
vi.mock("../db/budgets.js", () => budgetMocks);
vi.mock("../db/query.js", () => queryMocks);
vi.mock("../storage/index.js", () => storageMocks);
vi.mock("../lib/time.js", () => timeMocks);
vi.mock("../export/xlsx.js", () => xlsxMocks);
vi.mock("../capture/confidence.js", () => confidenceMocks);
vi.mock("./auth.js", () => sessionMock);

// ── Import after mocks ────────────────────────────────────────────────────────

import { expensesRoutes } from "./expenses.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXPENSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATEGORY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const STORED_UPDATED_AT = new Date("2026-06-14T10:00:00.000Z");
const STALE_UPDATED_AT = new Date("2026-06-14T09:00:00.000Z"); // 1h earlier

function makeExpenseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EXPENSE_ID,
    amount_cents: "10000",
    currency: "INR",
    description: "Coffee",
    merchant: "Blue Tokai",
    merchant_canonical_id: null,
    category_id: CATEGORY_ID,
    category: "Food",
    account_id: null,
    account: null,
    source: "manual",
    occurred_at: new Date("2026-06-14T00:00:00.000Z"),
    updated_at: STORED_UPDATED_AT,
    image_key: null,
    review_status: "reviewed",
    confidence: {},
    paid_by_user_id: null,
    settlement_scope: "personal",
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(multipart);
  await app.register(expensesRoutes);
  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/expenses/:id — optimistic locking", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.begin.mockReset();
    merchantMocks.getOrCreateMerchantCanonical.mockResolvedValue(null);
    merchantMocks.setMerchantCategory.mockResolvedValue(undefined);
    accountMocks.accountBelongsToUser.mockResolvedValue(true);
    accountMocks.guessAccountFromText.mockResolvedValue(null);
    accessMocks.isActiveLedgerMember.mockResolvedValue(true);
    auditMocks.recordAuditEvent.mockResolvedValue(undefined);
    tagMocks.getTagsForExpenses.mockResolvedValue(new Map());
    ruleSuggestionMocks.suggestionPatternFromText.mockReturnValue(null);
    ruleSuggestionMocks.upsertRuleSuggestion.mockResolvedValue(undefined);
    sessionMock.getSession.mockResolvedValue({
      userId: 12345,
      actorUserId: 12345,
      selectedLedgerKind: "personal",
    });
  });

  it("returns 409 when expectedUpdatedAt does not match stored updated_at", async () => {
    // The transaction fn receives a tx that first returns the locked row, then
    // we signal "conflict" — the route should return 409 and never apply an UPDATE.
    const tx = vi.fn();
    // First tx call: SELECT FOR UPDATE — returns the row with STORED_UPDATED_AT
    tx.mockResolvedValueOnce([makeExpenseRow()]);
    // No second call expected (the UPDATE should not run)

    sqlMock.begin.mockImplementationOnce(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        payload: {
          amount_cents: 20000,
          expectedUpdatedAt: STALE_UPDATED_AT.toISOString(),
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "Expense was modified by another request" });
      // The UPDATE was not applied: tx was called exactly once (the SELECT FOR UPDATE)
      expect(tx).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("returns 200 when expectedUpdatedAt matches stored updated_at", async () => {
    const updatedRow = makeExpenseRow({ amount_cents: "20000" });
    const tx = vi.fn();
    // First call: SELECT FOR UPDATE — returns current row
    tx.mockResolvedValueOnce([makeExpenseRow()]);
    // Second call: UPDATE CTE — returns updated row (with joins for category/account)
    tx.mockResolvedValueOnce([updatedRow]);

    sqlMock.begin.mockImplementationOnce(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        payload: {
          amount_cents: 20000,
          expectedUpdatedAt: STORED_UPDATED_AT.toISOString(),
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: EXPENSE_ID, amount_cents: "20000" });
      // Both SELECT FOR UPDATE and the UPDATE CTE ran
      expect(tx).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it("returns 200 when expectedUpdatedAt is omitted (backward-compatible)", async () => {
    const row = makeExpenseRow();
    const tx = vi.fn();
    tx.mockResolvedValueOnce([row]); // SELECT FOR UPDATE
    tx.mockResolvedValueOnce([row]); // UPDATE CTE

    sqlMock.begin.mockImplementationOnce(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        payload: { amount_cents: 10000 },
      });

      expect(res.statusCode).toBe(200);
      expect(tx).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it("returns 404 when the expense does not belong to the user", async () => {
    const tx = vi.fn();
    // SELECT FOR UPDATE returns empty — row not found / not owned
    tx.mockResolvedValueOnce([]);

    sqlMock.begin.mockImplementationOnce(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        payload: { amount_cents: 10000 },
      });

      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns 400 (not 409) when expectedUpdatedAt is a malformed timestamp", async () => {
    // No sql.begin should be called — the guard fires before the transaction.
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        payload: {
          amount_cents: 20000,
          expectedUpdatedAt: "not-a-date",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid expectedUpdatedAt timestamp" });
      // The transaction must not have been entered
      expect(sqlMock.begin).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
