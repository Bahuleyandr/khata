import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ParsedTransaction } from "./types.js";

// vi.mock is hoisted above imports by vitest's transformer
vi.mock("../db/index.js", () => ({ sql: vi.fn() }));

import { dedupeTransactions } from "./dedup.js";
import { sql } from "../db/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSql = sql as any;

// Magic-number sentinels — these tests will fail loudly if constants in dedup.ts drift
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000; // must match dedup.ts
const AMOUNT_TOLERANCE_CENTS = 50; // must match dedup.ts

function makeTx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-04-15",
    description: "coffee shop",
    amountCents: 10000,
    currency: "INR",
    suggestedCategory: "Food",
    ...overrides,
  };
}

function makeRow(overrides: {
  id?: string;
  amount_cents?: number;
  occurred_at?: Date;
  description?: string | null;
  merchant?: string | null;
} = {}) {
  return {
    id: overrides.id ?? "existing-id",
    amount_cents: BigInt(overrides.amount_cents ?? 10000),
    occurred_at: overrides.occurred_at ?? new Date("2026-04-15T00:00:00Z"),
    description: overrides.description ?? "coffee shop",
    merchant: overrides.merchant ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dedupeTransactions — magic numbers: 2-day window, ±50 cents, 0.4 overlap", () => {
  describe("exact duplicate", () => {
    it("flags as already logged when amount, date, and description are identical", async () => {
      mockSql.mockResolvedValue([makeRow()]);
      const [result] = await dedupeTransactions(1, [makeTx()]);
      expect(result!.alreadyLogged).toBe(true);
      expect(result!.matchedExpenseId).toBe("existing-id");
    });
  });

  describe("near-dup at boundary", () => {
    it("accepts match when amount differs by exactly AMOUNT_TOLERANCE_CENTS (50 cents)", async () => {
      mockSql.mockResolvedValue([makeRow({ amount_cents: 10000 + AMOUNT_TOLERANCE_CENTS })]);
      const [result] = await dedupeTransactions(1, [makeTx({ amountCents: 10000 })]);
      expect(result!.alreadyLogged).toBe(true);
    });

    it("rejects match when amount differs by AMOUNT_TOLERANCE_CENTS + 1 (51 cents)", async () => {
      mockSql.mockResolvedValue([makeRow({ amount_cents: 10000 + AMOUNT_TOLERANCE_CENTS + 1 })]);
      const [result] = await dedupeTransactions(1, [makeTx({ amountCents: 10000 })]);
      expect(result!.alreadyLogged).toBe(false);
    });

    it("accepts match when date differs by exactly TWO_DAYS_MS (2 full days)", async () => {
      // Verify the constant itself is correct
      expect(new Date("2026-04-17").getTime() - new Date("2026-04-15").getTime()).toBe(
        TWO_DAYS_MS,
      );
      mockSql.mockResolvedValue([makeRow({ occurred_at: new Date("2026-04-15T00:00:00Z") })]);
      const [result] = await dedupeTransactions(1, [makeTx({ date: "2026-04-17" })]);
      expect(result!.alreadyLogged).toBe(true);
    });

    it("rejects match when date is more than 2 days apart", async () => {
      mockSql.mockResolvedValue([makeRow({ occurred_at: new Date("2026-04-10T00:00:00Z") })]);
      const [result] = await dedupeTransactions(1, [makeTx({ date: "2026-04-15" })]);
      expect(result!.alreadyLogged).toBe(false);
    });

    it("accepts match at exactly 0.4 word-overlap threshold (2 of max-5 words match)", async () => {
      // ta: {alpha, beta, gamma, delta, epsilon} (5 tokens)
      // tb: {alpha, beta, zeta, eta, theta}     (5 tokens)
      // overlap = 2  →  score = 2/5 = 0.4  →  exactly at threshold (>= 0.4)
      mockSql.mockResolvedValue([makeRow({ description: "alpha beta zeta eta theta" })]);
      const [result] = await dedupeTransactions(1, [
        makeTx({ description: "alpha beta gamma delta epsilon" }),
      ]);
      expect(result!.alreadyLogged).toBe(true);
    });

    it("rejects match when word overlap is below 0.4 (1 of 3 words match ≈ 0.333)", async () => {
      // ta: {alpha, beta, gamma} | tb: {alpha, zeta, eta}
      // overlap = 1  →  1/3 ≈ 0.333 < 0.4
      mockSql.mockResolvedValue([makeRow({ description: "alpha zeta eta" })]);
      const [result] = await dedupeTransactions(1, [
        makeTx({ description: "alpha beta gamma" }),
      ]);
      expect(result!.alreadyLogged).toBe(false);
    });
  });

  describe("distinct same-day expenses", () => {
    it("does not flag as dup when descriptions share no common words", async () => {
      mockSql.mockResolvedValue([makeRow({ description: "electricity bill payment" })]);
      const [result] = await dedupeTransactions(1, [
        makeTx({ description: "grocery shopping supermarket" }),
      ]);
      expect(result!.alreadyLogged).toBe(false);
    });

    it("does not flag as dup when amounts differ beyond tolerance on same day", async () => {
      mockSql.mockResolvedValue([makeRow({ amount_cents: 20000 })]);
      const [result] = await dedupeTransactions(1, [makeTx({ amountCents: 10000 })]);
      expect(result!.alreadyLogged).toBe(false);
    });
  });

  describe("multi-currency", () => {
    it("does not flag as dup when amount_cents differ significantly across currencies", async () => {
      // $10 USD stored as 1000 cents vs ₹100 INR stored as 10000 cents
      // Gap of 9000 cents >> AMOUNT_TOLERANCE_CENTS (50) → no match
      mockSql.mockResolvedValue([makeRow({ amount_cents: 1000, description: "coffee shop" })]);
      const [result] = await dedupeTransactions(1, [
        makeTx({ amountCents: 10000, currency: "INR", description: "coffee shop" }),
      ]);
      expect(result!.alreadyLogged).toBe(false);
    });
  });

  describe("empty input", () => {
    it("returns empty array without querying DB", async () => {
      const result = await dedupeTransactions(1, []);
      expect(result).toEqual([]);
      expect(mockSql).not.toHaveBeenCalled();
    });
  });
});
