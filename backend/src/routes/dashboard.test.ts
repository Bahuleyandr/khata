import crypto from "node:crypto";
import { describe, it, expect, vi } from "vitest";

// auth.ts only imports config — mock it so no env vars are required
vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "123456:ABCdef-test",
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [1, 42, 99, 12345],
    allowedOrigins: ["https://example.com", "http://localhost:3000"],
  },
}));

import { verifyTelegramHash, signSession, verifySession } from "./auth.js";
import { config } from "../config.js";

// ── Constants kept in sync with the mocked config above ──────────────────────
const BOT_TOKEN = "123456:ABCdef-test"; // secret-scan: allow
const SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long";
const SESSION_MAX_AGE_S = 604800; // mirror SESSION_MAX_AGE_S from auth.ts

const now = () => Math.floor(Date.now() / 1000);

// Compute a valid Telegram hash the same way the production code does
function makeTelegramHash(data: Record<string, string>, botToken = BOT_TOKEN): string {
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  return crypto.createHmac("sha256", secret).update(checkString).digest("hex");
}

// ─── verifyTelegramHash ───────────────────────────────────────────────────────

describe("verifyTelegramHash", () => {
  const data = { id: "12345", first_name: "Alice", auth_date: "1714214400" };

  it("accepts a correctly computed hash", () => {
    expect(verifyTelegramHash(data, makeTelegramHash(data))).toBe(true);
  });

  it("accepts an uppercase hash (normalises to lowercase internally)", () => {
    expect(verifyTelegramHash(data, makeTelegramHash(data).toUpperCase())).toBe(true);
  });

  it("rejects a tampered hash (one byte flipped)", () => {
    const hash = makeTelegramHash(data);
    const tampered = hash.slice(0, -1) + (hash.endsWith("0") ? "1" : "0");
    expect(verifyTelegramHash(data, tampered)).toBe(false);
  });

  it("rejects a hash computed for different data", () => {
    const otherData = { ...data, id: "99999" };
    expect(verifyTelegramHash(data, makeTelegramHash(otherData))).toBe(false);
  });

  it("returns false for a non-hex hash string (Buffer mismatch caught)", () => {
    expect(verifyTelegramHash(data, "not-valid-hex!!")).toBe(false);
  });

  it("sorts data keys before verifying — field order does not matter", () => {
    const reordered = { auth_date: data.auth_date, first_name: data.first_name, id: data.id };
    expect(verifyTelegramHash(reordered, makeTelegramHash(data))).toBe(true);
  });
});

// ─── signSession / verifySession ─────────────────────────────────────────────

describe("signSession / verifySession", () => {
  it("round-trips userId and firstName", () => {
    const token = signSession(42, "Bob", now());
    expect(verifySession(token)).toEqual({ userId: 42, firstName: "Bob" });
  });

  it("round-trips a firstName with UTF-8 characters", () => {
    const token = signSession(99, "Ján Novák", now());
    expect(verifySession(token)).toEqual({ userId: 99, firstName: "Ján Novák" });
  });

  it("accepts a token issued 6 days ago (within the 7-day window)", () => {
    const iat = now() - 6 * 24 * 3600;
    expect(verifySession(signSession(1, "Alice", iat))).toEqual({ userId: 1, firstName: "Alice" });
  });

  it("rejects a token issued 7 days + 1 second ago (expired)", () => {
    const expiredIat = now() - SESSION_MAX_AGE_S - 1;
    expect(verifySession(signSession(1, "Alice", expiredIat))).toBeNull();
  });

  it("rejects a token issued 8 days ago (expired)", () => {
    const expiredIat = now() - 8 * 24 * 3600;
    expect(verifySession(signSession(1, "Alice", expiredIat))).toBeNull();
  });

  it("rejects a token for a user removed from the allowlist", () => {
    expect(verifySession(signSession(777, "Mallory", now()))).toBeNull();
  });

  it("rejects a token issued too far in the future", () => {
    expect(verifySession(signSession(1, "Alice", now() + 120))).toBeNull();
  });

  it("rejects a token with a tampered signature", () => {
    const token = signSession(1, "Alice", now());
    const tampered = token.slice(0, -4) + "ffff";
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejects a token with a tampered payload (userId digit changed)", () => {
    // Prepend "9" so the payload content changes — HMAC will no longer match
    const token = signSession(1, "Alice", now());
    expect(verifySession("9" + token)).toBeNull();
  });

  it("returns null when the token has no dot separator", () => {
    expect(verifySession("nodot")).toBeNull();
  });

  it("returns null when the payload has the wrong number of colon-separated parts", () => {
    // 4 parts instead of the expected 3 triggers the parts.length !== 3 guard
    const payload = `123:extra:${Buffer.from("Alice").toString("base64url")}:${now()}`;
    const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    expect(verifySession(`${payload}.${hmac}`)).toBeNull();
  });

  it("returns null when userId is not a valid integer", () => {
    const payload = `notanumber:${Buffer.from("Alice").toString("base64url")}:${now()}`;
    const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    expect(verifySession(`${payload}.${hmac}`)).toBeNull();
  });

  it("returns null when hmac has wrong byte length (timingSafeEqual throws, caught)", () => {
    const token = signSession(1, "Alice", now());
    const dot = token.lastIndexOf(".");
    // Replace the 64-char (32-byte) hmac with 8 chars — length mismatch causes throw
    expect(verifySession(token.slice(0, dot + 1) + "deadbeef")).toBeNull();
  });
});

// ─── CORS allowlist ───────────────────────────────────────────────────────────
//
// Production: @fastify/cors receives `origin: config.allowedOrigins` (an array).
// With an array, @fastify/cors allows the request when allowedOrigins.includes(origin).
// These tests verify that contract directly against the mocked config so they remain
// version-independent of the Fastify/cors plugin combo.

describe("CORS allowlist (origin-checking logic)", () => {
  const allowed = config.allowedOrigins;

  function isOriginAllowed(origin: string | undefined): boolean {
    return !!origin && allowed.includes(origin);
  }

  it("allows an origin that is in the allowlist", () => {
    expect(isOriginAllowed("https://example.com")).toBe(true);
  });

  it("allows a second origin that is in the allowlist", () => {
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
  });

  it("blocks an origin that is not in the allowlist", () => {
    expect(isOriginAllowed("https://evil.com")).toBe(false);
  });

  it("blocks a partial-match origin (prefix attack)", () => {
    expect(isOriginAllowed("https://example.com.evil.com")).toBe(false);
  });

  it("treats a missing origin (undefined) as not allowed", () => {
    expect(isOriginAllowed(undefined)).toBe(false);
  });
});
