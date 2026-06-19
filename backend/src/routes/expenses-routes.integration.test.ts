/**
 * Group D — Optimistic lock (route-level)
 * Group E — Settlement paid_by authz (route-level)
 * Group C3 — Capture route member authz (route-level)
 *
 * These use the full Fastify app via inject(). The CSRF guard checks Origin
 * header — all mutating requests include:
 *   Origin: http://localhost:3000
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  sql,
  truncateAll,
  seedBootstrapOwner,
  seedHouseholdWithMember,
  insertRawExpense,
  recordCaptureEvent,
} from "../test-support/db-helpers.js";
import { buildRealApp, makeSessionCookie } from "../test-support/app-helpers.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";

const OWNER_D = 30001;
const OWNER_E = 30002;
const MEMBER_E = 30003;
const OWNER_C3 = 30004;
const MEMBER_C3 = 30005;

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Optimistic lock
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("D: optimistic lock", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_D);
    app = await buildRealApp();
  });

  afterAll(async () => {
    await app?.close();
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("D1: stale expectedUpdatedAt → 409", async () => {
    const id = await insertRawExpense({ userId: OWNER_D, amountCents: 500, occurredAt: "2026-05-10T10:00:00Z" });
    const cookie = makeSessionCookie(OWNER_D, "Owner");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(OWNER_D),
      },
      payload: {
        amount_cents: 999,
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(409);
  });

  it("D2: correct expectedUpdatedAt → 200", async () => {
    const id = await insertRawExpense({ userId: OWNER_D, amountCents: 500, occurredAt: "2026-05-10T10:00:00Z" });
    const cookie = makeSessionCookie(OWNER_D, "Owner");

    const [row] = await sql.unsafe<Array<{ updated_at: string }>>(
      `SELECT updated_at::text AS updated_at FROM expenses WHERE id = '${id}'`,
    );
    const updatedAt = row!.updated_at;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(OWNER_D),
      },
      payload: {
        amount_cents: 999,
        expectedUpdatedAt: updatedAt,
      },
    });

    expect(res.statusCode).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — Settlement paid_by authz
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("E: settlement paid_by authz", () => {
  let app: FastifyInstance;
  let householdLedgerId: number;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_E);
    ({ householdLedgerId } = await seedHouseholdWithMember(OWNER_E, MEMBER_E));
    app = await buildRealApp();
  });

  afterAll(async () => {
    await app?.close();
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("E1: non-member paid_by_user_id → 400", async () => {
    const cookie = makeSessionCookie(OWNER_E, "Owner");
    const nonMemberId = 99999998;

    const res = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(householdLedgerId),
      },
      payload: {
        amount_cents: 500,
        occurred_at: "2026-05-10",
        description: "E1 test expense",
        settlement_scope: "shared",
        paid_by_user_id: nonMemberId,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error?: string };
    expect(body.error).toMatch(/member/i);
  });

  it("E2: active member paid_by_user_id → 201", async () => {
    const cookie = makeSessionCookie(OWNER_E, "Owner");

    const res = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(householdLedgerId),
      },
      payload: {
        amount_cents: 500,
        occurred_at: "2026-05-10",
        description: "E2 test expense",
        settlement_scope: "shared",
        paid_by_user_id: MEMBER_E,
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it("E3: non-manager member cannot attribute payment to ANOTHER member (forge) → 403", async () => {
    // MEMBER_E is can_add but NOT can_manage in the household ledger. Forging
    // paid_by to the owner would inflate the owner's "paid" and erase the
    // member's own debt (audit 2026-06-19 H2).
    const cookie = makeSessionCookie(MEMBER_E, "Member");
    const res = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(householdLedgerId),
      },
      payload: {
        amount_cents: 700,
        occurred_at: "2026-05-11",
        description: "E3 forged attribution",
        settlement_scope: "shared",
        paid_by_user_id: OWNER_E,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("E4: non-manager member MAY attribute payment to themselves → 201", async () => {
    const cookie = makeSessionCookie(MEMBER_E, "Member");
    const res = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(householdLedgerId),
      },
      payload: {
        amount_cents: 700,
        occurred_at: "2026-05-11",
        description: "E4 self attribution",
        settlement_scope: "shared",
        paid_by_user_id: MEMBER_E,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("E5: non-manager member cannot PATCH paid_by to another member → 403", async () => {
    const id = await insertRawExpense({
      userId: householdLedgerId,
      amountCents: 500,
      occurredAt: "2026-05-10T10:00:00Z",
    });
    const cookie = makeSessionCookie(MEMBER_E, "Member");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(householdLedgerId),
      },
      payload: {
        paid_by_user_id: OWNER_E,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C3 — Capture route: member session returns 200 and only ledger rows
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("C3: capture route member authz", () => {
  let app: FastifyInstance;
  let householdLedgerId: number;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_C3);
    ({ householdLedgerId } = await seedHouseholdWithMember(OWNER_C3, MEMBER_C3));
    app = await buildRealApp();
  });

  afterAll(async () => {
    await app?.close();
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("C3: member can list captures for their ledger; all rows belong to that ledger", async () => {
    await recordCaptureEvent({ userId: householdLedgerId, actorUserId: OWNER_C3, source: "telegram_text", rawText: "owner capture" });
    await recordCaptureEvent({ userId: householdLedgerId, actorUserId: MEMBER_C3, source: "telegram_text", rawText: "member capture" });

    const memberCookie = makeSessionCookie(MEMBER_C3, "Member");

    const res = await app.inject({
      method: "GET",
      url: "/api/captures",
      headers: {
        "Cookie": `session=${memberCookie}`,
        "x-khata-ledger-id": String(householdLedgerId),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { captures?: Array<{ user_id: number }> };
    if (body.captures) {
      for (const cap of body.captures) {
        expect(Number(cap.user_id)).toBe(householdLedgerId);
      }
    }
  });
});
