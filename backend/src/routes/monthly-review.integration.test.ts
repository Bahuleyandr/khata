/**
 * Group MR — review_status in spend aggregates and the immutable month close.
 *
 * Decision D2 (audit 2026-06-19):
 *   - live aggregates EXCLUDE `ignored` but KEEP `needs_review` (real spend);
 *   - the sealed month-close total EXCLUDES `needs_review` too (confirmed-only),
 *     so an unconfirmed/misread amount can't be frozen into the immutable close.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  sql,
  truncateAll,
  seedBootstrapOwner,
  seedCategory,
} from "../test-support/db-helpers.js";
import { buildRealApp, makeSessionCookie } from "../test-support/app-helpers.js";
import { spendByCategory } from "../db/query.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";

const OWNER_MR = 30001;

async function insertExpense(p: {
  userId: number;
  amountCents: number;
  occurredAt: string;
  categoryId: string;
  reviewStatus: string;
}): Promise<void> {
  await sql.unsafe(
    `INSERT INTO expenses
       (user_id, amount_cents, currency, description, source, occurred_at, category_id, review_status)
     VALUES (${p.userId}, ${p.amountCents}, 'INR', 'd2 test', 'manual',
             '${p.occurredAt}'::timestamptz, '${p.categoryId}', '${p.reviewStatus}')`,
  );
}

describe.skipIf(skip)("MR: review_status in aggregates & close (D2)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_MR);
    app = await buildRealApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("MR1: live aggregate excludes `ignored` but keeps `needs_review`", async () => {
    const cat = await seedCategory(OWNER_MR, "Food");
    await insertExpense({ userId: OWNER_MR, amountCents: 1000, occurredAt: "2026-03-15T12:00:00Z", categoryId: cat, reviewStatus: "reviewed" });
    await insertExpense({ userId: OWNER_MR, amountCents: 500, occurredAt: "2026-03-15T12:00:00Z", categoryId: cat, reviewStatus: "needs_review" });
    await insertExpense({ userId: OWNER_MR, amountCents: 300, occurredAt: "2026-03-15T12:00:00Z", categoryId: cat, reviewStatus: "ignored" });

    const rows = await spendByCategory(OWNER_MR, "2026-03-01", "2026-03-31");
    const food = rows.find((r) => r.category === "Food");
    // reviewed(1000) + needs_review(500) = 1500; ignored(300) excluded.
    expect(food?.total_cents).toBe("1500");
    expect(food?.count).toBe(2);
  });

  it("MR2: month close seals the confirmed total, excluding `needs_review`", async () => {
    const cat = await seedCategory(OWNER_MR, "Food");
    // A categorized needs_review expense with NO receipt leaves zero open
    // review tasks, so the month is closeable while it is still present.
    await insertExpense({ userId: OWNER_MR, amountCents: 1000, occurredAt: "2026-03-15T12:00:00Z", categoryId: cat, reviewStatus: "reviewed" });
    await insertExpense({ userId: OWNER_MR, amountCents: 500, occurredAt: "2026-03-15T12:00:00Z", categoryId: cat, reviewStatus: "needs_review" });

    const cookie = makeSessionCookie(OWNER_MR, "Owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/review/monthly/close",
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(OWNER_MR),
      },
      payload: { year: 2026, month: 3 },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await sql<Array<{ total_cents: string }>>`
      SELECT total_cents::text AS total_cents
      FROM monthly_closes
      WHERE user_id = ${OWNER_MR} AND period_month = '2026-03-01'::date
    `;
    // Sealed total is confirmed-only: reviewed(1000); needs_review(500) excluded.
    expect(row?.total_cents).toBe("1000");
  });
});
