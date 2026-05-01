import { describe, it, expect } from "vitest";
import { tryParseUpi } from "./parse.js";

describe("tryParseUpi", () => {
  it("parses a Google Pay confirmation", () => {
    const r = tryParseUpi("Sent ₹500 to John Doe via Google Pay");
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(500);
    expect(r!.merchant).toBe("John Doe");
    expect(r!.app).toBe("gpay");
    expect(r!.reference).toBeNull();
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
    expect(r!.occurredOn).toBe("2026-04-27");
  });

  it("parses an AMEX card spend alert", () => {
    const r = tryParseUpi(
      "Alert: You've spent INR 19,900.00 on your AMEX card ** 31009 at OPENAI OPCO on 28 April 2026 at 10:58 AM IST. Call 18004190691 if this was not made by you.",
    );
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(19900);
    expect(r!.merchant).toBe("OPENAI OPCO");
    expect(r!.app).toBe("bank");
    expect(r!.reference).toBeNull();
    expect(r!.occurredOn).toBe("2026-04-28");
  });

  it("parses the exact AMEX PAYU SWIGGY alert format", () => {
    const r = tryParseUpi(
      "Alert: You've spent INR 301.00 on your AMEX card ** 31009 at PAYU SWIGGY on 29 April 2026 at 12:56 PM IST. Call 18004190691 if this was not made by you.",
    );
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(301);
    expect(r!.merchant).toBe("PAYU SWIGGY");
    expect(r!.app).toBe("bank");
    expect(r!.occurredOn).toBe("2026-04-29");
  });

  it("does not parse card balance notices without spend language", () => {
    expect(tryParseUpi("Your AMEX card balance is INR 19,900.00 as of today.")).toBeNull();
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
    expect(r!.reference).toBe("112749168520");
    expect(r!.occurredOn).toBe("2026-04-27");
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
    expect(r!.reference).toBe("CHD53OR1IHJ2Z1");
    expect(r!.occurredOn).toBe("2026-04-27");
  });

  it("parses an IMPS payment confirmation screenshot OCR", () => {
    const text = [
      "GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT",
      "₹73,386",
      "Apartment 1A",
      "Request Accepted | Apr 29, 2026",
      "Transaction Summary",
      "Paid To : GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT",
      "Indian Overseas Bank",
      "Savings A/c: 209601000001470",
      "Paid By : DR T SUBASH CHANDHAR",
      "Payment Method",
      "Bank Transfer | IMPS",
      "HDFC Transaction ID",
      "HDFCDF529F4E338E",
      "Reference Number",
      "611954154961",
    ].join("\n");
    const r = tryParseUpi(text);
    expect(r).not.toBeNull();
    expect(r!.amountRupees).toBe(73386);
    expect(r!.merchant).toBe("GEE GEE MINAR RESIDENTS WELFARE ASSOCIAT");
    expect(r!.app).toBe("bank");
    expect(r!.reference).toBe("611954154961");
    expect(r!.occurredOn).toBe("2026-04-29");
  });

  describe("UPI reference / UTR extraction", () => {
    it("captures a UTR with bank prefix", () => {
      const r = tryParseUpi("Rs.500 debited via UPI to Foo. UTR: HDFC0000123456");
      expect(r?.reference).toBe("HDFC0000123456");
    });

    it("captures an RRN field", () => {
      const r = tryParseUpi("Sent Rs 250 via UPI to Bar. RRN 123456789012");
      expect(r?.reference).toBe("123456789012");
    });

    it("captures Txn ID with explicit qualifier", () => {
      const r = tryParseUpi("UPI debit Rs 100 to Baz. Txn ID: ABCD1234");
      expect(r?.reference).toBe("ABCD1234");
    });

    it("captures Reference No. with period and qualifier", () => {
      const r = tryParseUpi("Paid ₹50 to Quux via UPI. Reference No. XYZ987654");
      expect(r?.reference).toBe("XYZ987654");
    });

    it("uppercases lowercase ref tokens (OCR may emit lowercase)", () => {
      const r = tryParseUpi("Paid ₹50 via UPI to Foo. ref: abc123def");
      expect(r?.reference).toBe("ABC123DEF");
    });

    it("ignores noisy short tokens after a non-ref word", () => {
      // "tracking 12345" is short (5 chars) AND not preceded by a ref label
      const r = tryParseUpi("Paid ₹50 via UPI to Foo. tracking 12345");
      expect(r?.reference).toBeNull();
    });

    it("returns null reference when no ref label present", () => {
      const r = tryParseUpi("Sent ₹500 to John via Google Pay");
      expect(r?.reference).toBeNull();
    });
  });
});
