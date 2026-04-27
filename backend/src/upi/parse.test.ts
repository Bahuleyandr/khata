import { describe, it, expect } from "vitest";
import { tryParseUpi } from "./parse.js";

describe("tryParseUpi", () => {
  it("parses a Google Pay confirmation", () => {
    const r = tryParseUpi("Sent ₹500 to John Doe via Google Pay");
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(500);
    expect(r!.merchant).toBe("John Doe");
    expect(r!.app).toBe("gpay");
  });

  it("parses a Rs.-prefixed amount with comma separator", () => {
    const r = tryParseUpi("Rs.1,500.00 sent to ABC Store via PhonePe");
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(1500);
    expect(r!.merchant).toBe("ABC Store");
    expect(r!.app).toBe("phonepe");
  });

  it("parses a Paytm payment", () => {
    const r = tryParseUpi("Paytm: You paid Rs 250 to Local Cafe");
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(250);
    expect(r!.merchant).toBe("Local Cafe");
    expect(r!.app).toBe("paytm");
  });

  it("parses a bank debit SMS", () => {
    const r = tryParseUpi(
      "Your A/c XX1234 debited Rs.450.00 by UPI to ZOMATO ONLINE on 27-Apr-26",
    );
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(450);
    expect(r!.merchant).toBe("ZOMATO ONLINE");
    expect(r!.app).toBe("bank");
  });

  it("parses a decimal amount", () => {
    const r = tryParseUpi("Paid ₹99.50 to Coffee Shop via UPI");
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(99.5);
  });

  it("returns null for plain chat (no payment signal)", () => {
    expect(tryParseUpi("Hi how are you doing today?")).toBeNull();
  });

  it("returns null when ₹ is mentioned without payment context", () => {
    expect(tryParseUpi("This shirt costs ₹500 in Bangalore")).toBeNull();
  });

  it("returns null when amount is missing", () => {
    expect(tryParseUpi("Payment successful via Google Pay")).toBeNull();
  });

  it("returns parse with null merchant when 'to <name>' is unreadable", () => {
    const r = tryParseUpi("UPI debit Rs 200 successful");
    // No clear merchant — payment signal + amount present, merchant null
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(200);
    expect(r!.merchant).toBeNull();
  });

  it("rejects pathological-length input (>2000 chars)", () => {
    const huge = "Sent ₹500 to X via UPI ".repeat(200);
    expect(tryParseUpi(huge)).toBeNull();
  });

  it("rejects implausibly large amounts (>1 crore)", () => {
    expect(tryParseUpi("Sent Rs 99999999 to X via UPI")).toBeNull();
  });
});
