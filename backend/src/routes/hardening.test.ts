import Fastify from "fastify";
import cookie from "@fastify/cookie";
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "123456:ABCdef-test",
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [12345],
    allowedOrigins: ["http://localhost:3000"],
    databaseUrl: "postgres://unused",
  },
}));

vi.mock("../db/index.js", () => ({ sql: vi.fn() }));

import { authRoutes } from "./auth.js";
import { expensesRoutes } from "./expenses.js";

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
});
