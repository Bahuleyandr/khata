import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, sqlForDb } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { begin: vi.fn() });
  // getSession resolves a bootstrap owner's session-revocation epoch on every
  // authenticated request (audit 2026-06-19 H4). These route tests are not about
  // revocation, so answer that single query transparently with "no revocation"
  // ([]) — without consuming each test's ordered sqlMock queue or inflating its
  // call counts. Revocation behaviour itself is covered by access-authz H1.
  const sqlForDb = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join(" ").includes("sessions_invalid_before")) {
        return Promise.resolve([]);
      }
      return sqlMock(strings, ...values);
    },
    { begin: sqlMock.begin },
  );
  return { sqlMock, sqlForDb };
});
const merchantMocks = vi.hoisted(() => ({
  getOrCreateMerchantCanonical: vi.fn(),
  setMerchantCategory: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({
  getObjectStream: vi.fn(),
  uploadStatement: vi.fn(),
}));
const statementParserMocks = vi.hoisted(() => ({
  parseStatementBuffer: vi.fn(),
}));
const statementDedupMocks = vi.hoisted(() => ({
  dedupeTransactions: vi.fn(),
}));
const statementImporterMocks = vi.hoisted(() => ({
  bulkInsertTransactions: vi.fn(),
  createStatementRecord: vi.fn(),
  updateStatementStatus: vi.fn(),
}));
const accountMocks = vi.hoisted(() => ({
  accountBelongsToUser: vi.fn(),
  guessAccountFromText: vi.fn(),
}));
const smartRuleMocks = vi.hoisted(() => ({
  applySmartRules: vi.fn(),
  createSmartRule: vi.fn(),
  normalizeRuleTags: vi.fn((names?: string[]) =>
    Array.from(new Set((names ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean))),
  ),
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

vi.mock("../db/index.js", () => ({ sql: sqlForDb }));
vi.mock("../db/merchants.js", () => merchantMocks);
vi.mock("../storage/index.js", () => storageMocks);
vi.mock("../statement/parser.js", () => statementParserMocks);
vi.mock("../statement/dedup.js", () => statementDedupMocks);
vi.mock("../statement/importer.js", () => statementImporterMocks);
vi.mock("../db/accounts.js", () => accountMocks);
vi.mock("../db/smart-rules.js", () => smartRuleMocks);

import { authRoutes, signSession } from "./auth.js";
import { auditRoutes } from "./audit.js";
import { DASHBOARD_CORS_METHODS, dashboardCorsOptions } from "../http/cors.js";
import { budgetsRoutes } from "./budgets.js";
import { categoriesRoutes } from "./categories.js";
import { installCsrfOriginGuard } from "./csrf.js";
import { expensesRoutes } from "./expenses.js";
import { monthlyReviewRoutes } from "./monthly-review.js";
import { receiptsRoutes } from "./receipts.js";
import { statementsRoutes } from "./statements.js";
import { subscriptionsRoutes } from "./subscriptions.js";
import { tagsRoutes } from "./tags.js";

const EXPENSE_ID = "11111111-1111-4111-8111-111111111111";
const DUPLICATE_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const TAG_ID = "44444444-4444-4444-8444-444444444444";
const STATEMENT_ID = "55555555-5555-4555-8555-555555555555";
const STATEMENT_ROW_ID = "66666666-6666-4666-8666-666666666666";
const MONTH_CLOSE_ID = "77777777-7777-4777-8777-777777777777";

function authCookie(): string {
  return `session=${signSession(12345, "Subash", Math.floor(Date.now() / 1000))}`;
}

function makeTelegramHash(data: Record<string, string>, botToken = "123456:ABCdef-test"): string {
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  return crypto.createHmac("sha256", secret).update(checkString).digest("hex");
}

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(multipart);
  await installCsrfOriginGuard(app);
  await app.register(authRoutes);
  await app.register(expensesRoutes);
  await app.register(receiptsRoutes);
  await app.register(categoriesRoutes);
  await app.register(budgetsRoutes);
  await app.register(tagsRoutes);
  await app.register(statementsRoutes);
  await app.register(subscriptionsRoutes);
  await app.register(monthlyReviewRoutes);
  await app.register(auditRoutes);
  await app.ready();
  return app;
}

describe("route hardening", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.begin.mockReset();
    merchantMocks.getOrCreateMerchantCanonical.mockReset();
    merchantMocks.setMerchantCategory.mockReset();
    storageMocks.getObjectStream.mockReset();
    storageMocks.uploadStatement.mockReset();
    statementParserMocks.parseStatementBuffer.mockReset();
    statementDedupMocks.dedupeTransactions.mockReset();
    statementImporterMocks.bulkInsertTransactions.mockReset();
    statementImporterMocks.createStatementRecord.mockReset();
    statementImporterMocks.updateStatementStatus.mockReset();
    accountMocks.accountBelongsToUser.mockReset();
    accountMocks.guessAccountFromText.mockReset();
    smartRuleMocks.applySmartRules.mockReset();
    accountMocks.accountBelongsToUser.mockResolvedValue(true);
    accountMocks.guessAccountFromText.mockResolvedValue(null);
    smartRuleMocks.applySmartRules.mockResolvedValue({
      rule_id: null,
      rule_name: null,
      category_id: null,
      account_id: null,
      tag_names: [],
      review_status: null,
    });
  });

  it("clears the session cookie on logout", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/api/logout" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["set-cookie"]).toContain("session=");
      expect(res.headers["set-cookie"]).toContain("Max-Age=0");
    } finally {
      await app.close();
    }
  });

  it("rejects future-dated Telegram Login payloads even with a valid hash", async () => {
    const app = await buildApp();
    try {
      const data = {
        id: "12345",
        first_name: "Subash",
        auth_date: String(Math.floor(Date.now() / 1000) + 120),
      };
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/telegram",
        payload: { ...data, hash: makeTelegramHash(data) },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Auth token from the future" });
      expect(res.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("rejects invalid expense query params before auth or database work", async () => {
    const app = await buildApp();
    try {
      const badPage = await app.inject({ method: "GET", url: "/api/expenses?page=0" });
      expect(badPage.statusCode).toBe(400);

      const badSource = await app.inject({
        method: "GET",
        url: "/api/expenses?source=spreadsheet",
      });
      expect(badSource.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("advertises dashboard CORS methods needed by local editing flows", () => {
    expect(DASHBOARD_CORS_METHODS).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]);
    expect(dashboardCorsOptions().methods).toContain("PATCH");
    expect(dashboardCorsOptions().methods).toContain("DELETE");
  });

  it("creates categories through the authenticated dashboard API", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: CATEGORY_ID, name: "Travel", is_default: false }])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/categories",
        headers: { cookie: authCookie() },
        payload: { name: "  Travel  " },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        id: CATEGORY_ID,
        name: "Travel",
        is_default: false,
      });
      expect(sqlMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it("sets and clears an owned category budget", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: CATEGORY_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "budget-1", category_id: CATEGORY_ID, target_cents: "250000", period: "monthly" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "budget-1", category_id: CATEGORY_ID, target_cents: "250000", period: "monthly" },
      ])
      .mockResolvedValueOnce([{ id: "budget-1" }])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const setRes = await app.inject({
        method: "POST",
        url: "/api/budgets",
        headers: { cookie: authCookie() },
        payload: { category_id: CATEGORY_ID, target_cents: 250000 },
      });
      expect(setRes.statusCode).toBe(200);
      expect(setRes.json()).toEqual({ ok: true });

      const clearRes = await app.inject({
        method: "DELETE",
        url: `/api/budgets/${CATEGORY_ID}`,
        headers: { cookie: authCookie() },
      });
      expect(clearRes.statusCode).toBe(200);
      expect(clearRes.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("adds a tag only after the expense ownership check passes", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: EXPENSE_ID }])
      .mockResolvedValueOnce([{ id: TAG_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/expenses/${EXPENSE_ID}/tags`,
        headers: { cookie: authCookie() },
        payload: { name: " Team " },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, tag_id: TAG_ID });
      expect(sqlMock).toHaveBeenCalledTimes(4);
    } finally {
      await app.close();
    }
  });

  it("bulk-corrects review status, category, and tags for owned expenses", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: CATEGORY_ID }])
      .mockResolvedValueOnce([{ id: EXPENSE_ID }])
      .mockResolvedValueOnce([{ id: TAG_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: EXPENSE_ID, merchant: "Team Lunch", description: "team lunch" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/expenses/bulk",
        headers: { cookie: authCookie() },
        payload: {
          ids: [EXPENSE_ID],
          category_id: CATEGORY_ID,
          tag_names: ["team"],
          review_status: "reviewed",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, updated: 1 });
      expect(sqlMock).toHaveBeenCalledTimes(7);
    } finally {
      await app.close();
    }
  });

  it("creates a manual expense with category memory, tags, and audit logging", async () => {
    const occurredAt = new Date("2026-04-28T00:00:00.000Z");
    sqlMock
      .mockResolvedValueOnce([{ id: CATEGORY_ID }])
      .mockResolvedValueOnce([
        {
          id: EXPENSE_ID,
          amount_cents: "19900",
          currency: "INR",
          description: "Lunch",
          merchant: "OpenAI Cafe",
          merchant_canonical_id: "merchant-1",
          category_id: CATEGORY_ID,
          category: "Food",
          source: "manual",
          occurred_at: occurredAt,
          image_key: null,
          review_status: "reviewed",
        },
      ])
      .mockResolvedValueOnce([{ id: TAG_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ expense_id: EXPENSE_ID, name: "cash" }])
      .mockResolvedValueOnce([]);
    merchantMocks.getOrCreateMerchantCanonical.mockResolvedValueOnce("merchant-1");

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/expenses",
        headers: { cookie: authCookie() },
        payload: {
          amount_cents: 19900,
          merchant: " OpenAI Cafe ",
          description: "Lunch",
          category_id: CATEGORY_ID,
          occurred_at: "2026-04-28",
          tag_names: ["cash"],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        id: EXPENSE_ID,
        amount_cents: "19900",
        merchant: "OpenAI Cafe",
        source: "manual",
        tags: ["cash"],
      });
      expect(merchantMocks.setMerchantCategory).toHaveBeenCalledWith(
        12345,
        "merchant-1",
        CATEGORY_ID,
      );
      expect(sqlMock).toHaveBeenCalledTimes(6);
    } finally {
      await app.close();
    }
  });

  it("lists recent audit events for the authenticated user", async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: "55555555-5555-4555-8555-555555555555",
        actor_user_id: "12345",
        action: "expense.update",
        entity_type: "expense",
        entity_id: EXPENSE_ID,
        before: null,
        after: { id: EXPENSE_ID },
        metadata: {},
        created_at: new Date("2026-04-28T10:00:00.000Z"),
      },
    ]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/audit-log?limit=10&action=expense.update&entity_type=expense&entity_id=${EXPENSE_ID}`,
        headers: { cookie: authCookie() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        events: [
          {
            action: "expense.update",
            entity_type: "expense",
            entity_id: EXPENSE_ID,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("sets a subscription preference with audit logging", async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          merchant_key: "minimax",
          merchant_name: "MiniMax",
          status: "confirmed",
          note: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/subscriptions/minimax",
        headers: { cookie: authCookie() },
        payload: { merchant_name: "MiniMax", status: "confirmed" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        preference: {
          merchant_key: "minimax",
          status: "confirmed",
        },
      });
      expect(sqlMock).toHaveBeenCalledTimes(3);
    } finally {
      await app.close();
    }
  });

  it("uploads a dashboard statement into review rows and writes an audit event", async () => {
    statementImporterMocks.createStatementRecord.mockResolvedValueOnce(STATEMENT_ID);
    statementParserMocks.parseStatementBuffer.mockResolvedValueOnce([
      {
        date: "2026-04-28",
        description: "Metro card",
        amountCents: 7500,
        currency: "INR",
        suggestedCategory: "Transport",
      },
    ]);
    statementDedupMocks.dedupeTransactions.mockResolvedValueOnce([
      {
        transaction: {
          date: "2026-04-28",
          description: "Metro card",
          amountCents: 7500,
          currency: "INR",
          suggestedCategory: "Transport",
        },
        alreadyLogged: false,
      },
    ]);
    storageMocks.uploadStatement.mockResolvedValueOnce(undefined);
    statementImporterMocks.updateStatementStatus.mockResolvedValue(undefined);
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: STATEMENT_ROW_ID,
          statement_id: STATEMENT_ID,
          row_index: 0,
          occurred_at: "2026-04-28",
          description: "Metro card",
          amount_cents: "7500",
          currency: "INR",
          suggested_category: "Transport",
          category_id: CATEGORY_ID,
          category: "Transport",
          tag_names: [],
          already_logged: false,
          matched_expense_id: null,
          status: "pending",
          imported_expense_id: null,
          created_at: new Date("2026-04-28T00:00:00.000Z"),
          updated_at: new Date("2026-04-28T00:01:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: STATEMENT_ID,
          file_key: `statements/12345/${STATEMENT_ID}`,
          mime_type: "application/pdf",
          status: "parsed",
          parsed_count: 1,
          imported_count: 0,
          duplicate_count: 0,
          error_reason: null,
          created_at: new Date("2026-04-28T00:00:00.000Z"),
          updated_at: new Date("2026-04-28T00:01:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([]);

    const boundary = "----khata-test-boundary";
    const payload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="statement"; filename="statement.pdf"',
        "Content-Type: application/pdf",
        "",
        "%PDF-1.4 test statement",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/statements/upload",
        headers: {
          cookie: authCookie(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        parsed_count: 1,
        imported_count: 0,
        duplicate_count: 0,
        rows: [
          {
            id: STATEMENT_ROW_ID,
            status: "pending",
          },
        ],
        statement: {
          id: STATEMENT_ID,
          status: "parsed",
        },
      });
      expect(storageMocks.uploadStatement).toHaveBeenCalledWith(
        `statements/12345/${STATEMENT_ID}`,
        expect.any(Buffer),
        "application/pdf",
      );
      expect(statementParserMocks.parseStatementBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        "application/pdf",
      );
    } finally {
      await app.close();
    }
  });

  it("updates pending statement row category and tags before import", async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: CATEGORY_ID }])
      .mockResolvedValueOnce([
        {
          id: STATEMENT_ROW_ID,
          statement_id: STATEMENT_ID,
          row_index: 0,
          occurred_at: "2026-04-28",
          description: "Metro card",
          amount_cents: "7500",
          currency: "INR",
          suggested_category: "Transport",
          category_id: CATEGORY_ID,
          category: "Transport",
          tag_names: ["metro", "commute"],
          already_logged: false,
          matched_expense_id: null,
          status: "pending",
          imported_expense_id: null,
          created_at: new Date("2026-04-28T00:00:00.000Z"),
          updated_at: new Date("2026-04-28T00:01:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: STATEMENT_ROW_ID,
          statement_id: STATEMENT_ID,
          row_index: 0,
          occurred_at: "2026-04-28",
          description: "Metro card",
          amount_cents: "7500",
          currency: "INR",
          suggested_category: "Transport",
          category_id: CATEGORY_ID,
          category: "Transport",
          account_id: null,
          account: null,
          tag_names: ["metro", "commute"],
          already_logged: false,
          matched_expense_id: null,
          status: "pending",
          imported_expense_id: null,
          created_at: new Date("2026-04-28T00:00:00.000Z"),
          updated_at: new Date("2026-04-28T00:01:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/statements/${STATEMENT_ID}/rows/${STATEMENT_ROW_ID}`,
        headers: { cookie: authCookie() },
        payload: {
          category_id: CATEGORY_ID,
          tag_names: [" Metro ", "commute", "metro"],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: STATEMENT_ROW_ID,
        category_id: CATEGORY_ID,
        tag_names: ["metro", "commute"],
        status: "pending",
      });
      expect(sqlMock).toHaveBeenCalledTimes(4);
    } finally {
      await app.close();
    }
  });

  it("imports selected reviewed statement rows into expenses", async () => {
    const beforeStatement = {
      id: STATEMENT_ID,
      file_key: `statements/12345/${STATEMENT_ID}`,
      mime_type: "application/pdf",
      status: "parsed",
      parsed_count: 1,
      imported_count: 0,
      duplicate_count: 0,
      error_reason: null,
      created_at: new Date("2026-04-28T00:00:00.000Z"),
      updated_at: new Date("2026-04-28T00:01:00.000Z"),
    };
    const tx = vi.fn();
    tx.mockResolvedValueOnce([
      {
        id: STATEMENT_ROW_ID,
        statement_id: STATEMENT_ID,
        row_index: 0,
        occurred_at: "2026-04-28",
        description: "Metro card",
        amount_cents: "7500",
        currency: "INR",
        suggested_category: "Transport",
        already_logged: false,
        matched_expense_id: null,
        category_id: CATEGORY_ID,
        category: "Transport",
        tag_names: ["metro"],
        status: "pending",
        imported_expense_id: null,
        created_at: new Date("2026-04-28T00:00:00.000Z"),
        updated_at: new Date("2026-04-28T00:01:00.000Z"),
      },
    ])
      .mockResolvedValueOnce([{ id: EXPENSE_ID }])
      .mockResolvedValueOnce([{ id: TAG_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pending_count: "0" }])
      .mockResolvedValueOnce([{ ...beforeStatement, status: "imported", imported_count: 1 }]);
    sqlMock.begin.mockImplementationOnce(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    );
    sqlMock.mockResolvedValueOnce([beforeStatement]).mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/statements/${STATEMENT_ID}/import`,
        headers: { cookie: authCookie() },
        payload: { row_ids: [STATEMENT_ROW_ID] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        imported_count: 1,
        statement: {
          id: STATEMENT_ID,
          status: "imported",
          imported_count: 1,
        },
      });
      expect(tx).toHaveBeenCalledTimes(7);
    } finally {
      await app.close();
    }
  });

  it("returns a monthly close checklist with cleanup links", async () => {
    sqlMock
      .mockResolvedValueOnce([
        {
          transaction_count: "4",
          total_cents: "250000",
          uncategorized_count: "1",
          uncategorized_cents: "50000",
          needs_review_count: "2",
          receipts_needs_review_count: "1",
          missing_receipt_count: "1",
        },
      ])
      .mockResolvedValueOnce([{ duplicate_count: "2" }])
      .mockResolvedValueOnce([
        {
          total: "1",
          failed: "1",
          pending: "0",
          parsed: "0",
          imported: "0",
          parsed_count: "8",
          imported_count: "4",
          duplicate_count: "2",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: EXPENSE_ID,
          amount_cents: "50000",
          currency: "INR",
          merchant: null,
          description: "Cash lunch",
          category: "Uncategorized",
          review_status: "needs_review",
          occurred_at: new Date("2026-04-20T10:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "budget-1",
          category_id: CATEGORY_ID,
          category_name: "Food",
          target_cents: "100000",
          spent_cents: "200000",
        },
      ])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/review/monthly?year=2026&month=4",
        headers: { cookie: authCookie() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        period: { label: "April 2026", start: "2026-04-01", end: "2026-04-30" },
        overview: {
          transaction_count: 4,
          uncategorized_count: 1,
          receipts_needs_review_count: 1,
          duplicate_candidate_count: 2,
          open_task_count: 5,
        },
        statements: { total: 1, failed: 1, parsed_count: 8, imported_count: 4 },
        close: {
          status: "open",
          readiness_score: 17,
          can_close: false,
        },
      });
      expect(res.json().tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "uncategorized",
            status: "attention",
            href: "/transactions?start=2026-04-01&end=2026-04-30&uncategorized=true",
          }),
          expect.objectContaining({
            id: "receipts",
            href: "/receipts?start=2026-04-01&end=2026-04-30&review_status=needs_review",
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it("closes a monthly review when checklist blockers are clear", async () => {
    const closedAt = new Date("2026-05-01T08:00:00.000Z");
    sqlMock
      .mockResolvedValueOnce([
        {
          transaction_count: "2",
          total_cents: "125000",
          uncategorized_count: "0",
          uncategorized_cents: "0",
          needs_review_count: "0",
          receipts_needs_review_count: "0",
          missing_receipt_count: "0",
        },
      ])
      .mockResolvedValueOnce([{ duplicate_count: "0" }])
      .mockResolvedValueOnce([
        {
          total: "0",
          failed: "0",
          pending: "0",
          parsed: "0",
          imported: "0",
          parsed_count: "0",
          imported_count: "0",
          duplicate_count: "0",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: MONTH_CLOSE_ID,
          user_id: "12345",
          period_month: new Date("2026-04-01T00:00:00.000Z"),
          status: "closed",
          readiness_score: 100,
          open_task_count: 0,
          total_cents: "125000",
          transaction_count: 2,
          exported_at: null,
          closed_at: closedAt,
          reopened_at: null,
          actor_user_id: "12345",
          close_note: "Looks good",
          snapshot: {},
          created_at: closedAt,
          updated_at: closedAt,
        },
      ])
      .mockResolvedValueOnce([{ id: "audit-1" }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/review/monthly/close",
        headers: { cookie: authCookie() },
        payload: { year: 2026, month: 4, note: "Looks good" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        close: {
          status: "closed",
          readiness_score: 100,
          can_close: false,
          close_note: "Looks good",
        },
      });
      const auditCall = sqlMock.mock.calls.at(-1);
      expect(String(auditCall?.[0]?.[0])).toContain("INSERT INTO audit_log");
      expect(auditCall).toEqual(expect.arrayContaining(["month_close.close", "month_close", MONTH_CLOSE_ID]));
    } finally {
      await app.close();
    }
  });

  it("blocks cross-site mutating dashboard requests before database work", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        headers: {
          cookie: authCookie(),
          host: "khata.tailnet.ts.net",
          origin: "https://evil.example",
        },
        payload: { description: "tampered" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "Cross-site request blocked" });
      expect(sqlMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("updates an expense and persists merchant category memory", async () => {
    const occurredAt = new Date("2026-04-28T00:00:00.000Z");
    const updatedAt = new Date("2026-04-28T08:00:00.000Z");

    const beforeRow = {
      id: EXPENSE_ID,
      amount_cents: "12345",
      currency: "INR",
      description: "Dinner",
      merchant: "Swiggy",
      merchant_canonical_id: "merchant-1",
      category_id: CATEGORY_ID,
      category: "Food",
      account_id: null,
      account: null,
      source: "telegram",
      occurred_at: occurredAt,
      updated_at: updatedAt,
      image_key: null,
      review_status: "needs_review",
      confidence: {},
      paid_by_user_id: null,
      settlement_scope: "personal",
    };
    const afterRow = { ...beforeRow, review_status: "reviewed" };

    // category_id ownership check (outside the transaction)
    sqlMock.mockResolvedValueOnce([{ id: CATEGORY_ID }]);

    // audit event INSERT (outside the transaction, after begin returns)
    sqlMock.mockResolvedValueOnce([]);

    merchantMocks.getOrCreateMerchantCanonical.mockResolvedValueOnce("merchant-1");

    // Inside sql.begin: tx(SELECT FOR UPDATE) + tx(UPDATE CTE)
    const tx = vi.fn();
    tx.mockResolvedValueOnce([beforeRow]).mockResolvedValueOnce([afterRow]);
    sqlMock.begin.mockImplementationOnce(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/expenses/${EXPENSE_ID}`,
        headers: { cookie: authCookie() },
        payload: {
          amount_cents: 12345,
          description: "Dinner",
          merchant: "  Swiggy  ",
          category_id: CATEGORY_ID,
          occurred_at: "2026-04-28",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: EXPENSE_ID,
        amount_cents: "12345",
        merchant: "Swiggy",
        category_id: CATEGORY_ID,
        category: "Food",
      });
      expect(merchantMocks.getOrCreateMerchantCanonical).toHaveBeenCalledWith(12345, "Swiggy");
      expect(merchantMocks.setMerchantCategory).toHaveBeenCalledWith(
        12345,
        "merchant-1",
        CATEGORY_ID,
      );
    } finally {
      await app.close();
    }
  });

  it("deletes an owned expense", async () => {
    // Route delete now runs in sql.begin: tx does the DELETE then the audit INSERT (M10).
    const tx = vi.fn();
    tx.mockResolvedValueOnce([{ id: EXPENSE_ID }]).mockResolvedValueOnce([{ id: "audit-1" }]);
    sqlMock.begin.mockImplementationOnce(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/expenses/${EXPENSE_ID}`,
        headers: { cookie: authCookie() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("merges duplicate expenses and returns the kept row", async () => {
    const tx = vi.fn();
    tx.mockResolvedValueOnce([
      {
        id: EXPENSE_ID,
        amount_cents: "22000",
        occurred_at: new Date("2026-04-28T00:00:00.000Z"),
        description: "Coffee",
        merchant: "Blue Tokai",
        merchant_canonical_id: "merchant-1",
        category_id: null,
        raw_text: null,
        statement_id: null,
        image_key: null,
        content_hash: null,
        upi_reference_id: null,
      },
    ])
      .mockResolvedValueOnce([
        {
          id: DUPLICATE_ID,
          amount_cents: "22000",
          occurred_at: new Date("2026-04-28T00:30:00.000Z"),
          description: "Coffee duplicate",
          merchant: "Blue Tokai",
          merchant_canonical_id: "merchant-1",
          category_id: CATEGORY_ID,
          raw_text: "upi coffee",
          statement_id: null,
          image_key: "receipts/coffee.jpg",
          content_hash: "hash-1",
          upi_reference_id: "upi-1",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: EXPENSE_ID,
          amount_cents: "22000",
          currency: "INR",
          description: "Coffee",
          merchant: "Blue Tokai",
          merchant_canonical_id: "merchant-1",
          category_id: CATEGORY_ID,
          category: "Food",
          source: "receipt",
          occurred_at: new Date("2026-04-28T00:00:00.000Z"),
          image_key: "receipts/coffee.jpg",
        },
      ]);
    sqlMock.begin.mockImplementationOnce(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/expenses/${EXPENSE_ID}/merge`,
        headers: { cookie: authCookie() },
        payload: { duplicateId: DUPLICATE_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        expense: {
          id: EXPENSE_ID,
          category_id: CATEGORY_ID,
          image_key: "receipts/coffee.jpg",
        },
      });
      expect(tx).toHaveBeenCalledTimes(4);
    } finally {
      await app.close();
    }
  });

  it("lists receipt review data with category ids and proxy URLs", async () => {
    sqlMock
      .mockResolvedValueOnce([
        {
          id: EXPENSE_ID,
          amount_cents: "42500",
          currency: "INR",
          description: "Paper receipt",
          merchant: "Corner Store",
          category_id: CATEGORY_ID,
          category: "Groceries",
          occurred_at: new Date("2026-04-28T00:00:00.000Z"),
          image_key: "receipts/corner-store.jpg",
        },
      ])
      .mockResolvedValueOnce([{ count: "1" }]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/receipts?page=1&limit=24",
        headers: { cookie: authCookie() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        total: 1,
        page: 1,
        totalPages: 1,
        data: [
          {
            id: EXPENSE_ID,
            category_id: CATEGORY_ID,
            category: "Groceries",
            receipt_url: `/api/receipts/${EXPENSE_ID}/image`,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("streams receipt images only after ownership lookup succeeds", async () => {
    sqlMock.mockResolvedValueOnce([{ image_key: "receipts/corner-store.jpg" }]);
    storageMocks.getObjectStream.mockResolvedValueOnce({
      body: Readable.from(["image-bytes"]),
      contentType: "image/jpeg",
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/receipts/${EXPENSE_ID}/image`,
        headers: { cookie: authCookie() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("image/jpeg");
      expect(res.headers["cache-control"]).toContain("private");
      expect(res.body).toBe("image-bytes");
      expect(storageMocks.getObjectStream).toHaveBeenCalledWith("receipts/corner-store.jpg");
    } finally {
      await app.close();
    }
  });
});
