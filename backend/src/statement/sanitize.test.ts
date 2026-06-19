import { describe, it, expect } from "vitest";
import { sanitizeParsedTransactions } from "./sanitize.js";

const valid = {
  date: "2026-03-01",
  description: "Coffee",
  amountCents: 15000,
  currency: "INR",
  suggestedCategory: "Food",
};

describe("sanitizeParsedTransactions (M8)", () => {
  it("keeps valid positive-integer rows", () => {
    expect(sanitizeParsedTransactions([valid])).toEqual([valid]);
  });

  it("drops a non-integer amount but keeps the good rows (no whole-import abort)", () => {
    expect(sanitizeParsedTransactions([{ ...valid, amountCents: 12.5 }, valid])).toEqual([valid]);
  });

  it("drops NaN / Infinity / non-number amounts", () => {
    expect(
      sanitizeParsedTransactions([
        { ...valid, amountCents: NaN },
        { ...valid, amountCents: Infinity },
        { ...valid, amountCents: "100" },
      ]),
    ).toEqual([]);
  });

  it("drops non-positive amounts (credits/refunds are not subtracted from spend)", () => {
    expect(
      sanitizeParsedTransactions([{ ...valid, amountCents: -500 }, { ...valid, amountCents: 0 }]),
    ).toEqual([]);
  });

  it("drops rows with a missing or non-ISO date", () => {
    expect(
      sanitizeParsedTransactions([{ ...valid, date: "" }, { ...valid, date: "03/01/2026" }]),
    ).toEqual([]);
  });

  it("ignores non-object rows", () => {
    expect(sanitizeParsedTransactions([null, 42, "x", valid])).toEqual([valid]);
  });
});
