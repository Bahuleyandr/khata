import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}));

vi.mock("../db/index.js", () => ({ sql: sqlMock }));

import { dedupeTransactions } from "./dedup.js";
import type { ParsedTransaction } from "./types.js";

beforeEach(() => {
  sqlMock.mockReset();
});

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-04-15",
    description: "Coffee shop",
    amountCents: 25000,
    currency: "INR",
    suggestedCategory: "Food",
    ...overrides,
  };
}

interface RowOverrides {
  id?: string;
  amount_cents?: bigint;
  occurred_at?: Date;
  description?: string | null;
  merchant?: string | null;
}

function row(overrides: RowOverrides = {}) {
  return {
    id: "exp-1",
    amount_cents: 25000n,
    occurred_at: new Date("2026-04-15"),
    description: "Coffee shop",
    merchant: null as string | null,
    ...overrides,
  };
}

describe("dedupeTransactions", () => {
  it("returns empty array and skips DB query when input is empty", async () => {
    const result = await dedupeTransactions(1, []);
    expect(result).toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("matches an exact duplicate (same amount, date, description)", async () => {
    sqlMock.mockResolvedValue([row()]);
    const result = await dedupeTransactions(1, [tx()]);
    expect(result).toHaveLength(1);
    expect(result[0]!.alreadyLogged).toBe(true);
    expect(result[0]!.matchedExpenseId).toBe("exp-1");
  });

  it("does NOT match when amount differs by more than the 50-cent tolerance", async () => {
    sqlMock.mockResolvedValue([row({ amount_cents: 25051n })]);
    const result = await dedupeTransactions(1, [tx()]);
    expect(result[0]!.alreadyLogged).toBe(false);
  });

  it("matches when amount differs by exactly 50 cents (boundary inclusive)", async () => {
    sqlMock.mockResolvedValue([row({ amount_cents: 25050n })]);
    const result = await dedupeTransactions(1, [tx()]);
    expect(result[0]!.alreadyLogged).toBe(true);
  });

  it("does NOT match when date differs by more than 2 days", async () => {
    // 2026-04-15 vs 2026-04-12 = 3 days
    sqlMock.mockResolvedValue([row({ occurred_at: new Date("2026-04-12") })]);
    const result = await dedupeTransactions(1, [tx({ date: "2026-04-15" })]);
    expect(result[0]!.alreadyLogged).toBe(false);
  });

  it("matches when date differs by exactly 2 days (boundary inclusive)", async () => {
    sqlMock.mockResolvedValue([row({ occurred_at: new Date("2026-04-13") })]);
    const result = await dedupeTransactions(1, [tx({ date: "2026-04-15" })]);
    expect(result[0]!.alreadyLogged).toBe(true);
  });

  it("does NOT match when word-overlap score is below the 0.4 threshold", async () => {
    sqlMock.mockResolvedValue([
      row({ description: "Pharmacy refill prescription medication" }),
    ]);
    const result = await dedupeTransactions(1, [tx({ description: "Coffee shop morning" })]);
    expect(result[0]!.alreadyLogged).toBe(false);
  });

  it("matches when word overlap meets the 0.4 threshold", async () => {
    // tokens >2 chars: ["coffee","shop"] vs ["coffee","shop","morning","drink"]
    // overlap 2 / max(2,4) = 0.5 → matches
    sqlMock.mockResolvedValue([
      row({ description: "Coffee shop morning drink" }),
    ]);
    const result = await dedupeTransactions(1, [tx({ description: "Coffee shop" })]);
    expect(result[0]!.alreadyLogged).toBe(true);
  });

  it("falls back to merchant text when description is null on the candidate", async () => {
    sqlMock.mockResolvedValue([
      row({ description: null, merchant: "Coffee Shop" }),
    ]);
    const result = await dedupeTransactions(1, [tx({ description: "coffee shop visit" })]);
    expect(result[0]!.alreadyLogged).toBe(true);
  });

  it("returns alreadyLogged: false for every transaction when no candidates exist", async () => {
    sqlMock.mockResolvedValue([]);
    const result = await dedupeTransactions(1, [tx(), tx({ amountCents: 50000 })]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.alreadyLogged)).toBe(true);
  });

  it("handles a mix of matched and unmatched transactions in one batch", async () => {
    sqlMock.mockResolvedValue([row()]);
    const txs = [tx(), tx({ amountCents: 99999, description: "Different thing entirely" })];
    const result = await dedupeTransactions(1, txs);
    expect(result[0]!.alreadyLogged).toBe(true);
    expect(result[1]!.alreadyLogged).toBe(false);
  });

  it("matches each existing expense at most once (1:1), so genuine repeat charges still import", async () => {
    // A bank statement legitimately lists the SAME amount/merchant twice on the
    // same day (e.g. two identical chai or two Uber rides). Khata already has
    // ONE of them logged. Only the first incoming row should dedupe against it;
    // the second is a real, not-yet-logged charge and MUST import (not silently
    // collapse into the one existing expense).
    sqlMock.mockResolvedValue([row()]); // exactly one existing expense
    const result = await dedupeTransactions(1, [tx(), tx()]);
    expect(result[0]!.alreadyLogged).toBe(true);
    expect(result[0]!.matchedExpenseId).toBe("exp-1");
    expect(result[1]!.alreadyLogged).toBe(false);
    expect(result[1]!.matchedExpenseId).toBeUndefined();
  });

  it("pairs two incoming rows with two existing expenses one-to-one", async () => {
    sqlMock.mockResolvedValue([row({ id: "exp-1" }), row({ id: "exp-2" })]);
    const result = await dedupeTransactions(1, [tx(), tx()]);
    expect(result.every((r) => r.alreadyLogged)).toBe(true);
    expect(new Set(result.map((r) => r.matchedExpenseId))).toEqual(
      new Set(["exp-1", "exp-2"]),
    );
  });

  it("queries with a ±2-day window covering the widest input date range", async () => {
    sqlMock.mockResolvedValue([]);
    await dedupeTransactions(1, [
      tx({ date: "2026-04-10" }),
      tx({ date: "2026-04-20" }),
    ]);
    expect(sqlMock).toHaveBeenCalledOnce();
    const callArgs = sqlMock.mock.calls[0]!;
    // sql template tag: [strings, userId, minDate, maxDate]
    expect(callArgs[1]).toBe(1);
    const minDate = callArgs[2] as Date;
    const maxDate = callArgs[3] as Date;
    expect(minDate.toISOString().slice(0, 10)).toBe("2026-04-08");
    expect(maxDate.toISOString().slice(0, 10)).toBe("2026-04-22");
  });
});
