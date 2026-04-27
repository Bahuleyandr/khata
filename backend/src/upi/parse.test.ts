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

  it("parses a multi-line HDFC UPI debit notification (real-world format)", () => {
    const text = [
      "Sent Rs.11942.89",
      "From HDFC Bank A/C *6420",
      "To AMERICAN EXPRESS  CREDIT",
      "On 27/04/26",
      "Ref 112749168520",
      "Not You?",
      "Call 18002586161/SMS BLOCK UPI to 7308080808",
    ].join("\n");
    const r = tryParseUpi(text);
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(11942.89);
    expect(r!.merchant).toBe("AMERICAN EXPRESS CREDIT"); // double-space collapsed
    expect(r!.app).toBe("upi");
  });

  it("parses an AmEx bill-payment confirmation OCR (INR): amount pattern", () => {
    const text = [
      "Dear Cardmember,",
      "As requested, we have processed your American Express Card Bill payment.",
      "Following are the details of your payment:",
      "Last 5 digits of your Card: xxxx xxxx xxxx 91007",
      "Payment Amount (INR): 11942.89",
      "Payment Date: 27th April 2026",
      "Payment Through: HDFC UPI",
      "Transaction Identification Number: CHD53OR1IHJ2Z1",
    ].join("\n");
    const r = tryParseUpi(text);
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(11942.89);
    // No "to <merchant>" pattern in this OCR — merchant null is acceptable
    expect(r!.app).toBe("upi");
  });
});
