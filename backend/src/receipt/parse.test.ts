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

  it("parses fragmented OCR where payment and bare amount land on separate lines", () => {
    const text = [
      "HMSHost Services India Pvt Ltd",
      "Kempegowda International Airport",
      "THIS IS A TAX INVOICE",
      "30 Apr '26 19:41",
      "Take-Out",
      "Evian BTL 0.5",
      "152.40",
      "Credit Card",
      "160.00",
      "Subtotal",
      "152.40",
      "CGST 2.5%",
      "3.81",
      "SGST 2.5%",
      "3.81",
      "Rounding",
      "0.02",
      "Payment",
      "160.00",
      "Change Due",
      "0.00",
    ].join("\n");

    const parsed = tryParseReceiptText(text, categories, "2026-05-03");
    expect(parsed?.amount).toBe(160);
    expect(parsed?.merchant).toBe("HMSHost Services India Pvt Ltd");
    expect(parsed?.occurred_at).toBe("2026-04-30");
  });

  it("falls back to the largest receipt amount when total labels are mangled", () => {
    const text = [
      "HMSHost Services India Pvt Ltd",
      "Kempegowda International Airport",
      "THIS IS A TAX INVOICE",
      "30 Apr '26 19:41",
      "Take-Out",
      "Evian BTL 0.5",
      "152.40",
      "Card",
      "160.00",
      "CGST 2.5%",
      "3.81",
      "SGST 2.5%",
      "3.81",
      "Rounding",
      "0.02",
      "Change",
      "0.00",
    ].join("\n");

    const parsed = tryParseReceiptText(text, categories, "2026-05-03");
    expect(parsed?.amount).toBe(160);
    expect(parsed?.merchant).toBe("HMSHost Services India Pvt Ltd");
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

  it("parses Indian lakh-grouped bare totals at full value", () => {
    const text = [
      "BIG BAZAAR",
      "Date: 27 Apr 2026",
      "LED TV 1,00,000.00",
      "Refrigerator 1,50,000.00",
      "Grand Total 2,50,000.00",
    ].join("\n");

    const parsed = tryParseReceiptText(text, categories, "2026-05-03");
    expect(parsed?.amount).toBe(250000);
  });

  it("never treats change-due as the bill total", () => {
    const text = [
      "CORNER STORE",
      "Date: 27 Apr 2026",
      "Milk 100.00",
      "Amount Due 100.00",
      "Cash 500.00",
      "Change Due 400.00",
    ].join("\n");

    const parsed = tryParseReceiptText(text, categories, "2026-05-03");
    expect(parsed?.amount).toBe(100);
  });

  it("does not parse ordinary text without receipt signals", () => {
    expect(tryParseReceiptText("hello this is a random photo with 160 written on it", categories, "2026-05-03")).toBeNull();
  });
});
