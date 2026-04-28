import Fastify from "fastify";
import cookie from "@fastify/cookie";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => Object.assign(vi.fn(), { begin: vi.fn() }));
const merchantMocks = vi.hoisted(() => ({
  getOrCreateMerchantCanonical: vi.fn(),
  setMerchantCategory: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "123456:ABCdef-test",
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [12345],
    allowedOrigins: ["http://localhost:3000"],
    databaseUrl: "postgres://unused",
  },
}));

vi.mock("../db/index.js", () => ({ sql: sqlMock }));
vi.mock("../db/merchants.js", () => merchantMocks);

import { authRoutes, signSession } from "./auth.js";
import { expensesRoutes } from "./expenses.js";

const EXPENSE_ID = "11111111-1111-4111-8111-111111111111";
const DUPLICATE_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

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
  await app.register(authRoutes);
  await app.register(expensesRoutes);
  await app.ready();
  return app;
}

describe("route hardening", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.begin.mockReset();
    merchantMocks.getOrCreateMerchantCanonical.mockReset();
    merchantMocks.setMerchantCategory.mockReset();
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

  it("updates an expense and persists merchant category memory", async () => {
    const occurredAt = new Date("2026-04-28T00:00:00.000Z");
    sqlMock
      .mockResolvedValueOnce([{ id: CATEGORY_ID }])
      .mockResolvedValueOnce([
        {
          id: EXPENSE_ID,
          amount_cents: "12345",
          currency: "INR",
          description: "Dinner",
          merchant: "Swiggy",
          merchant_canonical_id: "merchant-1",
          category_id: CATEGORY_ID,
          category: "Food",
          source: "telegram",
          occurred_at: occurredAt,
          image_key: null,
        },
      ]);
    merchantMocks.getOrCreateMerchantCanonical.mockResolvedValueOnce("merchant-1");

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
    sqlMock.mockResolvedValueOnce([{ id: EXPENSE_ID }]);
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
});
