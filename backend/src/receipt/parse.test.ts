import { describe, expect, it } from "vitest";
import { tryParseReceiptText } from "./parse.js";

const categories = ["Food", "Transport", "Groceries", "Bills", "Other"];

describe("tryParseReceiptText", () => {
  it("parses airport POS tax invoices with payment due as the final amount", () => {
    const text = [
      "HMSHost Services India Pvt Ltd",
      "Cones The Groove Dom T1",
      "Kempegowda International Airport,",
      "Devanahalli, Karnataka, Bengaluru",
      "THIS IS A TAX INVOICE",
      "910040871 Vivek",
      "M/S#: 100012",
      "CHK 674817",
      "30 Apr'26 19:41 PM",
      "Take-Out",
      "1 Evian BTL 0.5 INR152.40",
      "Credit Card INR160.00",
      "Subtotal INR152.40",
      "CGST 2.5% INR3.81",
      "SGST 2.5% INR3.81",
      "Rounding INR0.02",
      "Payment Due INR160.00",
      "Change Due INR0.00",
    ].join("\n");

    expect(tryParseReceiptText(text, categories, "2026-05-03")).toEqual({
      amount: 160,
      currency: "INR",
      description: "HMSHost Services India Pvt Ltd receipt",
      merchant: "HMSHost Services India Pvt Ltd",
      occurred_at: "2026-04-30",
      category: "Food",
    });
  });

  it("parses simple retail receipts with currency-prefixed totals", () => {
    const text = [
      "STARBUCKS",
      "Date: 27 Apr 2026",
      "Caffe Latte INR 250.00",
      "Subtotal INR 238.10",
      "CGST INR 5.95",
      "SGST INR 5.95",
      "Grand Total INR 250.00",
    ].join("\n");

    const parsed = tryParseReceiptText(text, categories, "2026-05-03");
    expect(parsed?.amount).toBe(250);
    expect(parsed?.merchant).toBe("STARBUCKS");
    expect(parsed?.occurred_at).toBe("2026-04-27");
  });

  it("does not parse ordinary text without receipt signals", () => {
    expect(tryParseReceiptText("hello this is a random photo with 160 written on it", categories, "2026-05-03")).toBeNull();
  });
});
