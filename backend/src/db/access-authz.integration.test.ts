/**
 * Group C — Captures authz (db-level C1/C2)
 * Group G — Ledger isolation
 * Group F — Subscription advance + reminder dedup
 *
 * All run at the db-function level (no HTTP).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  sql,
  truncateAll,
  seedBootstrapOwner,
  seedHouseholdWithMember,
  insertRawExpense,
  getExpenseForEdit,
  recordCaptureEvent,
  listCaptureEvents,
  isActiveLedgerMember,
  advanceOverdueSubscriptions,
} from "../test-support/db-helpers.js";
import {
  resolveSessionAccessForTelegramUser,
  setSessionsInvalidBefore,
} from "../db/access.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";

// USER IDs
const OWNER_C = 20001;
const MEMBER_C = 20002;
const OWNER_G = 20003;
const MEMBER_G = 20004;
const OWNER_F = 20005;

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Captures authz (db-level)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("C: captures authz (db-level)", () => {
  let householdLedgerId: number;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_C);
    ({ householdLedgerId } = await seedHouseholdWithMember(OWNER_C, MEMBER_C));
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  it("C1: listCaptureEvents with actorUserId filter returns only actor's captures", async () => {
    await recordCaptureEvent({ userId: householdLedgerId, actorUserId: OWNER_C, source: "telegram_text", rawText: "owner capture" });
    await recordCaptureEvent({ userId: householdLedgerId, actorUserId: MEMBER_C, source: "telegram_text", rawText: "member capture" });

    const memberCaptures = await listCaptureEvents(householdLedgerId, { actorUserId: MEMBER_C });
    expect(memberCaptures.length).toBe(1);
    expect(memberCaptures[0]?.actor_user_id).toBe(String(MEMBER_C));
  });

  it("C2: owner (no actorUserId filter) sees all captures in ledger", async () => {
    await recordCaptureEvent({ userId: householdLedgerId, actorUserId: OWNER_C, source: "telegram_text", rawText: "owner capture" });
    await recordCaptureEvent({ userId: householdLedgerId, actorUserId: MEMBER_C, source: "dashboard_manual", rawText: "member capture" });

    const allCaptures = await listCaptureEvents(householdLedgerId);
    expect(allCaptures.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G — Ledger isolation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("G: ledger isolation", () => {
  let ownerLedgerId: number;
  let memberLedgerId: number;

  beforeEach(async () => {
    await truncateAll();
    ({ ledgerId: ownerLedgerId } = await seedBootstrapOwner(OWNER_G));
    ({ ledgerId: memberLedgerId } = await seedBootstrapOwner(MEMBER_G));
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  it("G1: getExpenseForEdit with wrong userId returns null", async () => {
    const id = await insertRawExpense({ userId: ownerLedgerId, amountCents: 500, occurredAt: "2026-05-10T10:00:00Z" });
    const result = await getExpenseForEdit(id, memberLedgerId);
    expect(result).toBeNull();
  });

  it("G2: listCaptureEvents for otherUser returns empty", async () => {
    await recordCaptureEvent({ userId: ownerLedgerId, source: "telegram_text", rawText: "owner only" });
    const result = await listCaptureEvents(memberLedgerId);
    expect(result.length).toBe(0);
  });

  it("G3: isActiveLedgerMember returns false for non-member", async () => {
    // memberLedgerId is member's own personal ledger; OWNER_G is not a member of it.
    const result = await isActiveLedgerMember(memberLedgerId, OWNER_G);
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F — Subscription advance + reminder dedup
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("F: subscription advance + reminder dedup (db-level)", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_F);
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  async function insertSub(params: {
    userId: number;
    billingCycle: string;
    nextDueAt: string;
    intervalDays?: number | null;
    anchorDom?: number | null;
    reminderDays?: number[];
  }): Promise<string> {
    const intervalDays = params.intervalDays ?? null;
    const anchorDom = params.anchorDom ?? null;
    const reminderDays = params.reminderDays ?? [];
    const rows = await sql.unsafe<Array<{ id: string }>>(`
      INSERT INTO subscriptions
        (user_id, name, status, billing_cycle, amount_cents, currency, next_due_at,
         interval_days, anchor_dom, reminder_days)
      VALUES
        (${params.userId}, 'Test Sub', 'active', '${params.billingCycle}', 100, 'INR',
         '${params.nextDueAt}'::date,
         ${intervalDays === null ? "NULL" : intervalDays},
         ${anchorDom === null ? "NULL" : anchorDom},
         ARRAY[${reminderDays.join(",")}]::integer[])
      RETURNING id
    `);
    return rows[0]!.id;
  }

  it("F1: overdue monthly sub advances past today (correct DOM)", async () => {
    await insertSub({ userId: OWNER_F, billingCycle: "monthly", nextDueAt: "2024-01-15", anchorDom: 15 });
    const count = await advanceOverdueSubscriptions();
    expect(count).toBeGreaterThan(0);
    const [row] = await sql.unsafe<Array<{ next_due_at: string }>>(
      `SELECT next_due_at::text AS next_due_at FROM subscriptions WHERE user_id = ${OWNER_F}`,
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(row!.next_due_at > today).toBe(true);
    const dom = parseInt(row!.next_due_at.slice(-2), 10);
    expect(dom).toBe(15);
  });

  it("F2: overdue weekly sub advances past today", async () => {
    await insertSub({ userId: OWNER_F, billingCycle: "weekly", nextDueAt: "2024-01-01" });
    await advanceOverdueSubscriptions();
    const [row] = await sql.unsafe<Array<{ next_due_at: string }>>(
      `SELECT next_due_at::text AS next_due_at FROM subscriptions WHERE user_id = ${OWNER_F}`,
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(row!.next_due_at > today).toBe(true);
  });

  it("F3: reminder dedup guard suppresses double-send", async () => {
    const dueDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const subId = await insertSub({
      userId: OWNER_F,
      billingCycle: "monthly",
      nextDueAt: dueDate,
      reminderDays: [7],
    });
    // Simulate "already sent" by inserting guard row.
    await sql.unsafe(`
      INSERT INTO subscription_reminder_state (subscription_id, user_id, cycle_due_date, reminded_days)
      VALUES ('${subId}', ${OWNER_F}, '${dueDate}'::date, 7)
      ON CONFLICT DO NOTHING
    `);
    // Try to insert again — ON CONFLICT DO NOTHING means count stays 1.
    await sql.unsafe(`
      INSERT INTO subscription_reminder_state (subscription_id, user_id, cycle_due_date, reminded_days)
      VALUES ('${subId}', ${OWNER_F}, '${dueDate}'::date, 7)
      ON CONFLICT DO NOTHING
    `);
    const rows = await sql.unsafe<Array<{ subscription_id: string }>>(`
      SELECT subscription_id FROM subscription_reminder_state
      WHERE subscription_id = '${subId}' AND cycle_due_date = '${dueDate}'::date AND reminded_days = 7
    `);
    expect(rows.length).toBe(1);
  });

  it("F4: reminder fires (guard row absent → insert succeeds)", async () => {
    const dueDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const subId = await insertSub({
      userId: OWNER_F,
      billingCycle: "monthly",
      nextDueAt: dueDate,
      reminderDays: [7],
    });
    // No guard row — first-time insert succeeds.
    await sql.unsafe(`
      INSERT INTO subscription_reminder_state (subscription_id, user_id, cycle_due_date, reminded_days)
      VALUES ('${subId}', ${OWNER_F}, '${dueDate}'::date, 7)
    `);
    const [row] = await sql.unsafe<Array<{ subscription_id: string }>>(`
      SELECT subscription_id FROM subscription_reminder_state WHERE subscription_id = '${subId}'
    `);
    expect(row).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group H — Bootstrap owner session revocation (audit 2026-06-19 H4)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("H: bootstrap owner session revocation", () => {
  const OWNER_H = 30001;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_H);
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  it("H1: bootstrap-owner session path honors setSessionsInvalidBefore", async () => {
    // Freshly seeded: no revocation epoch yet.
    const before = await resolveSessionAccessForTelegramUser(OWNER_H);
    expect(before?.sessionsInvalidBefore).toBeNull();

    // "Log out everywhere" / revoke writes the epoch to the access_users row.
    await setSessionsInvalidBefore(OWNER_H);

    // The bootstrap-owner session path must reflect the real epoch, otherwise a
    // stolen owner cookie survives logout until the 7-day max age (H4). The
    // resolved value must match the DB column, not be hardcoded null.
    const after = await resolveSessionAccessForTelegramUser(OWNER_H);
    expect(after?.sessionsInvalidBefore).toBeInstanceOf(Date);

    const [row] = await sql<Array<{ sib: Date | null }>>`
      SELECT sessions_invalid_before AS sib
      FROM access_users
      WHERE telegram_user_id = ${OWNER_H}
    `;
    expect(row?.sib).toBeInstanceOf(Date);
    expect(after?.sessionsInvalidBefore?.getTime()).toBe(row?.sib?.getTime());
  });
});
