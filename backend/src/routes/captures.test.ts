import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const captureMocks = vi.hoisted(() => ({
  listCaptureEvents: vi.fn(),
  getCaptureEvent: vi.fn(),
  markCaptureIgnored: vi.fn(),
  markCaptureReplayStarted: vi.fn(),
  markCaptureProcessed: vi.fn(),
  markCaptureFailed: vi.fn(),
  summarizeCaptureFailures: vi.fn(),
  summarizeCaptureStatuses: vi.fn(),
  summarizeCaptureSources: vi.fn(),
}));

const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "123456:ABCdef-test",
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [1001, 1002],
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

vi.mock("../db/captures.js", () => captureMocks);
vi.mock("./auth.js", () => sessionMock);

vi.mock("../db/audit.js", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/accounts.js", () => ({
  guessAccountFromText: vi.fn().mockResolvedValue(null),
}));

vi.mock("../db/categories.js", () => ({
  getUserCategories: vi.fn().mockResolvedValue([]),
  getCategoryByName: vi.fn().mockResolvedValue(null),
}));

vi.mock("../db/expenses.js", () => ({
  insertExpense: vi.fn().mockResolvedValue("expense-uuid-1"),
}));

vi.mock("../db/overrides.js", () => ({
  getOverrides: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/smart-rules.js", () => ({
  applySmartRules: vi.fn().mockResolvedValue({
    rule_id: null,
    rule_name: null,
    category_id: null,
    account_id: null,
    tag_names: [],
    review_status: null,
  }),
}));

vi.mock("../db/tags.js", () => ({
  getOrCreateTag: vi.fn().mockResolvedValue(null),
  attachTagToExpense: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ai/parse.js", () => ({
  classifyMessage: vi.fn().mockResolvedValue({ type: "unknown" }),
}));

vi.mock("../upi/parse.js", () => ({
  tryParseUpi: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/time.js", () => ({
  todayIst: vi.fn().mockReturnValue("2026-06-14"),
}));

// ── Import routes AFTER mocks ─────────────────────────────────────────────────

import { capturesRoutes } from "./captures.js";

// ── Test constants ────────────────────────────────────────────────────────────

const CAPTURE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeOwnerSession() {
  return {
    userId: 9000,
    ledgerUserId: 9000,
    personalLedgerId: 9000,
    telegramUserId: 1001,
    actorUserId: 1001,
    firstName: "Owner",
    role: "owner" as const,
    isOwner: true,
    selectedLedgerId: 9000,
    selectedLedgerName: "Family",
    selectedLedgerKind: "household" as const,
    canView: true,
    canAdd: true,
    canManage: true,
  };
}

function makeMemberSession() {
  return {
    ...makeOwnerSession(),
    telegramUserId: 1002,
    actorUserId: 1002,
    firstName: "Member",
    role: "member" as const,
    isOwner: false,
    canManage: false,
  };
}

function makeCaptureRow(actorUserId: number | string) {
  return {
    id: CAPTURE_ID,
    user_id: 9000,
    actor_user_id: String(actorUserId),
    source: "telegram_text" as const,
    raw_text: "coffee 100",
    file_key: null,
    content_hash: null,
    mime_type: null,
    status: "failed" as const,
    parsed_expense_id: null,
    parsed_expense_label: null,
    error_reason: "parse error",
    failure_kind: "parse_failed" as const,
    diagnosis: { title: "t", detail: "d", next_action: "n", replayable: true },
    metadata: {},
    confidence: {} as never,
    replay_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    processed_at: null,
    last_replayed_at: null,
  };
}

async function buildApp() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(capturesRoutes);
  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("captures authz — GET /api/captures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureMocks.listCaptureEvents.mockResolvedValue([]);
  });

  it("passes actorUserId:undefined when session.canManage is true (owner sees all)", async () => {
    sessionMock.getSession.mockResolvedValue(makeOwnerSession());
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/captures" });
      expect(res.statusCode).toBe(200);
      expect(captureMocks.listCaptureEvents).toHaveBeenCalledOnce();
      const [, filters] = captureMocks.listCaptureEvents.mock.calls[0]!;
      expect(filters.actorUserId).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("passes actorUserId:session.actorUserId when session.canManage is false (member sees own)", async () => {
    sessionMock.getSession.mockResolvedValue(makeMemberSession());
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/captures" });
      expect(res.statusCode).toBe(200);
      expect(captureMocks.listCaptureEvents).toHaveBeenCalledOnce();
      const [, filters] = captureMocks.listCaptureEvents.mock.calls[0]!;
      expect(filters.actorUserId).toBe(1002);
    } finally {
      await app.close();
    }
  });
});

describe("captures authz — GET /api/captures/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureMocks.summarizeCaptureFailures.mockResolvedValue([]);
    captureMocks.summarizeCaptureStatuses.mockResolvedValue([]);
    captureMocks.summarizeCaptureSources.mockResolvedValue([]);
  });

  it("calls summarize* with actorUserId:undefined for owner", async () => {
    sessionMock.getSession.mockResolvedValue(makeOwnerSession());
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/captures/summary" });
      expect(res.statusCode).toBe(200);
      const failuresArgs = captureMocks.summarizeCaptureFailures.mock.calls[0]!;
      expect(failuresArgs[1]).toBeUndefined();
      const statusesArgs = captureMocks.summarizeCaptureStatuses.mock.calls[0]!;
      expect(statusesArgs[1]).toBeUndefined();
      const sourcesArgs = captureMocks.summarizeCaptureSources.mock.calls[0]!;
      expect(sourcesArgs[1]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("calls summarize* with actorUserId:1002 for member", async () => {
    sessionMock.getSession.mockResolvedValue(makeMemberSession());
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/captures/summary" });
      expect(res.statusCode).toBe(200);
      const failuresArgs = captureMocks.summarizeCaptureFailures.mock.calls[0]!;
      expect(failuresArgs[1]).toBe(1002);
      const statusesArgs = captureMocks.summarizeCaptureStatuses.mock.calls[0]!;
      expect(statusesArgs[1]).toBe(1002);
      const sourcesArgs = captureMocks.summarizeCaptureSources.mock.calls[0]!;
      expect(sourcesArgs[1]).toBe(1002);
    } finally {
      await app.close();
    }
  });
});

describe("captures authz — POST /api/captures/:id/ignore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403 when member tries to ignore another actor's capture", async () => {
    sessionMock.getSession.mockResolvedValue(makeMemberSession()); // actorUserId:1002
    // Capture belongs to owner (actor_user_id:1001)
    captureMocks.getCaptureEvent.mockResolvedValue(makeCaptureRow(1001));
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/captures/${CAPTURE_ID}/ignore`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "Access denied" });
      expect(captureMocks.markCaptureIgnored).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("200 when member ignores their own capture", async () => {
    sessionMock.getSession.mockResolvedValue(makeMemberSession()); // actorUserId:1002
    // Capture belongs to member (actor_user_id:1002)
    const row = makeCaptureRow(1002);
    captureMocks.getCaptureEvent.mockResolvedValue(row);
    captureMocks.markCaptureIgnored.mockResolvedValue({ ...row, status: "ignored" });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/captures/${CAPTURE_ID}/ignore`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(captureMocks.markCaptureIgnored).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("200 when owner ignores another actor's capture", async () => {
    sessionMock.getSession.mockResolvedValue(makeOwnerSession()); // canManage:true, actorUserId:1001
    // Capture belongs to member (actor_user_id:1002)
    const row = makeCaptureRow(1002);
    captureMocks.getCaptureEvent.mockResolvedValue(row);
    captureMocks.markCaptureIgnored.mockResolvedValue({ ...row, status: "ignored" });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/captures/${CAPTURE_ID}/ignore`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(captureMocks.markCaptureIgnored).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});

describe("captures authz — POST /api/captures/:id/replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403 when member tries to replay another actor's capture", async () => {
    sessionMock.getSession.mockResolvedValue(makeMemberSession()); // actorUserId:1002
    // Capture belongs to owner (actor_user_id:1001)
    captureMocks.getCaptureEvent.mockResolvedValue(makeCaptureRow(1001));
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/captures/${CAPTURE_ID}/replay`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "Access denied" });
      expect(captureMocks.markCaptureReplayStarted).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("owner is allowed to replay another actor's capture (proceeds past authz gate)", async () => {
    sessionMock.getSession.mockResolvedValue(makeOwnerSession()); // canManage:true
    // Capture belongs to member (actor_user_id:1002) — raw_text intentionally null
    // to hit the 422 branch, confirming we passed the authz gate
    captureMocks.getCaptureEvent.mockResolvedValue({ ...makeCaptureRow(1002), raw_text: null });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/captures/${CAPTURE_ID}/replay`,
      });
      // 422 means we passed authz and hit the "no raw_text" check
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "Only text captures can be replayed here" });
    } finally {
      await app.close();
    }
  });
});
