/**
 * Group A — Month-close trigger (immutability + IST bucketing)
 * Group B — jsonb round-trip (confidence, diagnosis, snapshot)
 * Group H — Budget IST bucketing (getBudgetsWithMtd)
 *
 * All run at the db-function level (no HTTP). Trigger logic lives in SQL and
 * cannot be exercised by the unit suite (which mocks `sql`).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  sql,
  truncateAll,
  seedBootstrapOwner,
  seedCategory,
  insertRawExpense,
  closeMonth,
  reopenMonth,
  closeMonthlyPeriod,
  insertExpense,
  recordCaptureEvent,
  markCaptureFailed,
  setBudget,
  getBudgetsWithMtd,
} from "../test-support/db-helpers.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";

// USER IDs (non-overlapping across groups)
const OWNER_A = 10001;
const OWNER_B = 10002;
const OWNER_H = 10003;

// ─────────────────────────────────────────────────────────────────────────────
// Group A — Month-close trigger
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("A: month-close trigger", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_A);
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  it("A1: closed month blocks INSERT", async () => {
    await closeMonth(OWNER_A, "2026-04-01");
    await expect(
      insertRawExpense({ userId: OWNER_A, amountCents: 500, occurredAt: "2026-04-15T12:00:00Z" }),
    ).rejects.toThrow(/KHATA_MONTH_CLOSED/);
  });

  it("A2: closed month blocks UPDATE", async () => {
    const id = await insertRawExpense({ userId: OWNER_A, amountCents: 1000, occurredAt: "2026-04-15T12:00:00Z" });
    await closeMonth(OWNER_A, "2026-04-01");
    await expect(
      sql.unsafe(`UPDATE expenses SET amount_cents = 99999 WHERE id = '${id}'`),
    ).rejects.toThrow(/KHATA_MONTH_CLOSED/);
  });

  it("A3: closed month blocks DELETE", async () => {
    const id = await insertRawExpense({ userId: OWNER_A, amountCents: 1000, occurredAt: "2026-04-15T12:00:00Z" });
    await closeMonth(OWNER_A, "2026-04-01");
    await expect(
      sql.unsafe(`DELETE FROM expenses WHERE id = '${id}'`),
    ).rejects.toThrow(/KHATA_MONTH_CLOSED/);
  });

  it("A4: reopened month restores writes", async () => {
    const id = await insertRawExpense({ userId: OWNER_A, amountCents: 1000, occurredAt: "2026-04-15T12:00:00Z" });
    await closeMonth(OWNER_A, "2026-04-01");
    await reopenMonth(OWNER_A, "2026-04-01");
    await sql.unsafe(`UPDATE expenses SET amount_cents = 77777 WHERE id = '${id}'`);
    const rows = await sql.unsafe<Array<{ amount_cents: string }>>(
      `SELECT amount_cents::text FROM expenses WHERE id = '${id}'`,
    );
    expect(rows[0]?.amount_cents).toBe("77777");
  });

  it("A5: expense at 2026-06-30T20:30Z is JULY-IST — closing JUNE does NOT block it", async () => {
    const id = await insertRawExpense({ userId: OWNER_A, amountCents: 1000, occurredAt: "2026-06-30T20:30:00Z" });
    await closeMonth(OWNER_A, "2026-06-01");
    await sql.unsafe(`UPDATE expenses SET amount_cents = 10001 WHERE id = '${id}'`);
    const rows = await sql.unsafe<Array<{ amount_cents: string }>>(
      `SELECT amount_cents::text FROM expenses WHERE id = '${id}'`,
    );
    expect(rows[0]?.amount_cents).toBe("10001");
  });

  it("A6: expense at 2026-06-30T20:30Z is JULY-IST — closing JULY DOES block it", async () => {
    const id = await insertRawExpense({ userId: OWNER_A, amountCents: 1000, occurredAt: "2026-06-30T20:30:00Z" });
    await closeMonth(OWNER_A, "2026-07-01");
    await expect(
      sql.unsafe(`UPDATE expenses SET amount_cents = 20000 WHERE id = '${id}'`),
    ).rejects.toThrow(/KHATA_MONTH_CLOSED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — jsonb round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("B: jsonb round-trip", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_B);
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  it("B1: insertExpense stores confidence as jsonb OBJECT (not string)", async () => {
    const confidence = { overall: 85, amount: 100, date: 95, merchant: 90, category: 80, account: 75, source: 98, reasons: [] as string[] };
    await insertExpense({
      userId: OWNER_B,
      amount_cents: 1000,
      currency: "INR",
      description: "B1 test",
      merchant: null,
      category_id: null,
      occurred_at: new Date("2026-05-10T10:00:00Z"),
      source: "manual",
      raw_text: null,
      confidence,
    });
    const [row] = await sql.unsafe<Array<{ t: string }>>(
      `SELECT jsonb_typeof(confidence) AS t FROM expenses WHERE user_id = ${OWNER_B} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row?.t).toBe("object");
  });

  it("B2: confidence reads back as JS object (correct field values)", async () => {
    const confidence = { overall: 72, amount: 80, date: 90, merchant: 70, category: 60, account: 65, source: 95, reasons: ["low_merchant"] };
    const id = await insertExpense({
      userId: OWNER_B,
      amount_cents: 2000,
      currency: "INR",
      description: "B2 test",
      merchant: null,
      category_id: null,
      occurred_at: new Date("2026-05-11T10:00:00Z"),
      source: "manual",
      raw_text: null,
      confidence,
    });
    const [row] = await sql.unsafe<Array<{ confidence: unknown }>>(
      `SELECT confidence FROM expenses WHERE id = '${id}' AND user_id = ${OWNER_B}`,
    );
    expect(typeof row?.confidence).toBe("object");
    expect((row?.confidence as Record<string, unknown>)?.overall).toBe(72);
  });

  it("B3: markCaptureFailed stores diagnosis as jsonb OBJECT", async () => {
    const captureId = await recordCaptureEvent({
      userId: OWNER_B,
      source: "telegram_text",
      rawText: "B3 test",
    });
    await markCaptureFailed(OWNER_B, captureId, "LLM returned empty response");
    const [row] = await sql.unsafe<Array<{ t: string }>>(
      `SELECT jsonb_typeof(diagnosis) AS t FROM capture_events WHERE id = '${captureId}'`,
    );
    expect(row?.t).toBe("object");
  });

  it("B4: closeMonthlyPeriod stores snapshot as jsonb OBJECT", async () => {
    await closeMonthlyPeriod({
      userId: OWNER_B,
      actorUserId: OWNER_B,
      periodMonth: "2026-04-01",
      readinessScore: 100,
      openTaskCount: 0,
      totalCents: 50000,
      transactionCount: 5,
      snapshot: { total_cents: 50000, transaction_count: 5, readiness_score: 100 },
    });
    const [row] = await sql.unsafe<Array<{ t: string }>>(
      `SELECT jsonb_typeof(snapshot) AS t FROM monthly_closes WHERE user_id = ${OWNER_B}`,
    );
    expect(row?.t).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group H — Budget IST bucketing
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("H: budget IST bucketing", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_H);
  });

  afterAll(async () => {
    // Pool stays open for subsequent test files sharing this fork process.
  });

  it("H1: expense at 2026-06-30T20:30Z counts in July getBudgetsWithMtd", async () => {
    const categoryId = await seedCategory(OWNER_H, "Food");
    await setBudget(OWNER_H, categoryId, 10000);
    await insertRawExpense({ userId: OWNER_H, amountCents: 999, occurredAt: "2026-06-30T20:30:00Z", categoryId });
    const budgets = await getBudgetsWithMtd(OWNER_H, "2026-07");
    const food = budgets.find((b) => b.category_id === categoryId);
    expect(food?.spent_cents).toBe(999);
  });

  it("H2: same expense does NOT count in June getBudgetsWithMtd", async () => {
    const categoryId = await seedCategory(OWNER_H, "Transport");
    await setBudget(OWNER_H, categoryId, 10000);
    await insertRawExpense({ userId: OWNER_H, amountCents: 999, occurredAt: "2026-06-30T20:30:00Z", categoryId });
    const budgets = await getBudgetsWithMtd(OWNER_H, "2026-06");
    const transport = budgets.find((b) => b.category_id === categoryId);
    expect(transport?.spent_cents ?? 0).toBe(0);
  });
});
