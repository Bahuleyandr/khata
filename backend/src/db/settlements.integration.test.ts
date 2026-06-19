/**
 * Group SE — household settlement must net to zero (audit 2026-06-19 H3).
 *
 * Two ways the old code broke the invariant sum(balances) == 0:
 *   (1) fairShare = round(total/n) leaves a rounding residual;
 *   (2) a payment attributed to a non-member (revoked, or any paid_by not in
 *       the current member set) stayed in `total` but was dropped from the
 *       payer rollup, so credited payments < total.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql, truncateAll, seedHouseholdWithMember } from "../test-support/db-helpers.js";
import { computeHouseholdSettlement } from "./settlements.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";
const OWNER_SE = 30002;
const MEMBER_SE = 30003;
const NON_MEMBER = 99999; // not a member of this household

async function insertShared(p: {
  ledgerId: number;
  amountCents: number;
  paidBy: number | null;
  occurredAt: string;
}): Promise<void> {
  const paid = p.paidBy === null ? "NULL" : String(p.paidBy);
  await sql.unsafe(`
    INSERT INTO expenses
      (user_id, amount_cents, currency, description, source, occurred_at, settlement_scope, paid_by_user_id)
    VALUES (${p.ledgerId}, ${p.amountCents}, 'INR', 'se test', 'manual',
            '${p.occurredAt}'::timestamptz, 'shared', ${paid})
  `);
}

function sumBalances(payers: Array<{ balance_cents: string }>): number {
  return payers.reduce((s, p) => s + Number(p.balance_cents), 0);
}

describe.skipIf(skip)("SE: household settlement nets to zero (H3)", () => {
  let householdLedgerId: number;

  beforeEach(async () => {
    await truncateAll();
    ({ householdLedgerId } = await seedHouseholdWithMember(OWNER_SE, MEMBER_SE));
  });

  afterAll(async () => {
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("SE1: an odd total splits with no rounding residual (balances sum to 0)", async () => {
    await insertShared({ ledgerId: householdLedgerId, amountCents: 1001, paidBy: OWNER_SE, occurredAt: "2026-03-15T12:00:00Z" });
    const s = await computeHouseholdSettlement(householdLedgerId, 2026, 3);
    expect(sumBalances(s.payers)).toBe(0);
    expect(s.total_cents).toBe("1001");
  });

  it("SE2: a payment by a non-member is still credited, not dropped (balances sum to 0)", async () => {
    await insertShared({ ledgerId: householdLedgerId, amountCents: 600, paidBy: OWNER_SE, occurredAt: "2026-03-15T12:00:00Z" });
    await insertShared({ ledgerId: householdLedgerId, amountCents: 400, paidBy: NON_MEMBER, occurredAt: "2026-03-15T12:00:00Z" });
    const s = await computeHouseholdSettlement(householdLedgerId, 2026, 3);
    expect(sumBalances(s.payers)).toBe(0);
    expect(s.total_cents).toBe("1000");
  });
});
