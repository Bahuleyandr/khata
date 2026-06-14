import { describe, expect, it } from "vitest";
import { buildCaptureConfidence, confidenceLabel, reviewStatusFromConfidence } from "./confidence.js";

describe("capture confidence", () => {
  it("scores deterministic UPI captures high enough to auto-review", () => {
    const confidence = buildCaptureConfidence({
      amountCents: 30100,
      occurredAt: new Date("2026-05-01T12:00:00Z"),
      merchant: "RAZORPAY SWI",
      description: "RAZORPAY SWI",
      categoryId: "cat-food",
      accountId: "acct-amex",
      source: "telegram",
      parser: "upi_regex",
      rawText: "Alert: You've spent INR 301.00 on your AMEX card",
    });

    expect(confidence.overall).toBeGreaterThanOrEqual(90);
    expect(confidenceLabel(confidence)).toBe("high");
    expect(reviewStatusFromConfidence(undefined, confidence)).toBe("reviewed");
  });

  it("keeps missing category/account captures in the review queue", () => {
    const confidence = buildCaptureConfidence({
      amountCents: 16000,
      occurredAt: new Date("2026-04-30T12:00:00Z"),
      merchant: null,
      description: "Receipt",
      categoryId: null,
      accountId: null,
      source: "receipt",
      parser: "llm",
      rawText: "Total INR160.00",
    });

    expect(confidence.overall).toBeLessThan(82);
    expect(confidence.reasons).toContain("category_missing");
    expect(reviewStatusFromConfidence(undefined, confidence)).toBe("needs_review");
  });

  it("never auto-reviews a weakly-extracted amount, even when every other field is clean", () => {
    const confidence = buildCaptureConfidence({
      amountCents: 50000,
      occurredAt: new Date("2026-04-30T12:00:00Z"),
      merchant: "Some Store",
      description: "Some Store receipt",
      categoryId: "cat-food",
      accountId: "acct-amex",
      source: "receipt",
      parser: "receipt_regex",
      amountQuality: "weak",
      rawText: "a fairly long raw receipt body with plenty of text",
    });

    expect(confidence.amount).toBeLessThan(80);
    expect(confidence.reasons).toContain("amount_uncertain");
    expect(reviewStatusFromConfidence(undefined, confidence)).toBe("needs_review");
  });

  it("auto-reviews a strong-total amount with otherwise clean fields", () => {
    const confidence = buildCaptureConfidence({
      amountCents: 50000,
      occurredAt: new Date("2026-04-30T12:00:00Z"),
      merchant: "Some Store",
      description: "Some Store receipt",
      categoryId: "cat-food",
      accountId: "acct-amex",
      source: "receipt",
      parser: "receipt_regex",
      amountQuality: "labeled_total",
      rawText: "a fairly long raw receipt body with plenty of text",
    });

    expect(confidence.amount).toBe(100);
    expect(reviewStatusFromConfidence(undefined, confidence)).toBe("reviewed");
  });
});
