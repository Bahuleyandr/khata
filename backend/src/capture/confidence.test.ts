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
});
