/**
 * Unit tests for statement route rate-limit enforcement.
 * Mirrors the pattern in captures.test.ts: Fastify inject with mocked
 * dependencies, no real database, no real storage.
 */

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

// Rate-limit mock — allow by default; individual tests override as needed.
const rateLimitMocks = vi.hoisted(() => ({
  askLimiter: { allow: vi.fn().mockReturnValue({ ok: true, retryAfterMs: 0 }) },
  captureLimiter: { allow: vi.fn().mockReturnValue({ ok: true, retryAfterMs: 0 }) },
  replayLimiter: { allow: vi.fn().mockReturnValue({ ok: true, retryAfterMs: 0 }) },
  statementLimiter: { allow: vi.fn().mockReturnValue({ ok: true, retryAfterMs: 0 }) },
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "123456:ABCdef-test",
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [1001],
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

vi.mock("./auth.js", () => sessionMock);
vi.mock("../lib/rate-limit.js", () => rateLimitMocks);

vi.mock("../db/index.js", () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { begin: vi.fn() }),
}));
vi.mock("../db/accounts.js", () => ({
  accountBelongsToUser: vi.fn().mockResolvedValue(true),
  guessAccountFromText: vi.fn().mockResolvedValue(null),
}));
vi.mock("../db/audit.js", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../db/smart-rules.js", () => ({
  applySmartRules: vi.fn().mockResolvedValue({
    rule_id: null, rule_name: null, category_id: null, account_id: null,
    tag_names: [], review_status: null,
  }),
}));
vi.mock("../db/rule-suggestions.js", () => ({
  suggestionPatternFromText: vi.fn().mockReturnValue(null),
  upsertRuleSuggestion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../capture/confidence.js", () => ({
  buildCaptureConfidence: vi.fn().mockReturnValue({ overall: 80 }),
}));
vi.mock("../storage/index.js", () => ({
  uploadStatement: vi.fn().mockResolvedValue(undefined),
  getObjectStream: vi.fn().mockResolvedValue({
    body: (async function* () { yield Buffer.from(""); })(),
    contentType: "application/pdf",
  }),
}));
vi.mock("../statement/parser.js", () => ({
  parseStatementBuffer: vi.fn().mockResolvedValue([]),
}));
vi.mock("../statement/dedup.js", () => ({
  dedupeTransactions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../statement/importer.js", () => ({
  createStatementRecord: vi.fn().mockResolvedValue("stmt-uuid-1"),
  updateStatementStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../statement/redact.js", () => ({
  redactError: vi.fn((e: unknown) => String(e)),
}));

// ── Import routes AFTER mocks ─────────────────────────────────────────────────

import { statementsRoutes } from "./statements.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeOwnerSession() {
  return {
    userId: 9000,
    actorUserId: 1001,
    ledgerUserId: 9000,
    personalLedgerId: 9000,
    selectedLedgerId: 9000,
    selectedLedgerName: "Family",
    selectedLedgerKind: "household" as const,
    telegramUserId: 1001,
    firstName: "Owner",
    role: "owner" as const,
    isOwner: true,
    canView: true,
    canAdd: true,
    canManage: true,
  };
}

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(multipart);
  await app.register(statementsRoutes);
  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("rate-limit enforcement — POST /api/statements/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.statementLimiter.allow.mockReturnValue({ ok: true, retryAfterMs: 0 });
    sessionMock.getSession.mockResolvedValue(makeOwnerSession());
  });

  it("returns 429 with Retry-After header when statementLimiter denies", async () => {
    rateLimitMocks.statementLimiter.allow.mockReturnValueOnce({ ok: false, retryAfterMs: 15_000 });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/statements/upload",
        payload: {},
      });
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: "Rate limit exceeded, try again shortly" });
      // Retry-After header must be present (ceiling of 15000ms → "15")
      expect(res.headers["retry-after"]).toBe("15");
      // Storage and parser must not be touched
      const { uploadStatement } = await import("../storage/index.js");
      expect(vi.mocked(uploadStatement)).not.toHaveBeenCalled();
      const { parseStatementBuffer } = await import("../statement/parser.js");
      expect(vi.mocked(parseStatementBuffer)).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe("rate-limit enforcement — POST /api/statements/:id/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.statementLimiter.allow.mockReturnValue({ ok: true, retryAfterMs: 0 });
    sessionMock.getSession.mockResolvedValue(makeOwnerSession());
  });

  it("returns 429 with Retry-After header when statementLimiter denies", async () => {
    rateLimitMocks.statementLimiter.allow.mockReturnValueOnce({ ok: false, retryAfterMs: 9_000 });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/statements/${STATEMENT_ID}/retry`,
      });
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: "Rate limit exceeded, try again shortly" });
      // Retry-After header must be present (ceiling of 9000ms → "9")
      expect(res.headers["retry-after"]).toBe("9");
      // Parser must not be touched
      const { parseStatementBuffer } = await import("../statement/parser.js");
      expect(vi.mocked(parseStatementBuffer)).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
