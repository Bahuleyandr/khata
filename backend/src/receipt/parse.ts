import type { ParsedExpense } from "../ai/parse.js";

const RECEIPT_SIGNAL =
  /\b(?:receipt|tax\s+invoice|invoice|gstin|cgst|sgst|subtotal|sub\s*total|grand\s+total|payment\s+due|amount\s+due|check\s+closed|credit\s+card|cash|take[-\s]?out)\b/i;

const STRONG_TOTAL_LABEL =
  /\b(?:payment\s+due|amount\s+due|grand\s+total|net\s+amount|total\s+amount|total\s+payable|balance\s+due|change\s+due)\b/i;
const TOTAL_LABEL = /\btotal\b/i;
const PAYMENT_LABEL = /\b(?:paid|payment|credit\s+card|debit\s+card|cash|upi)\b/i;
const SUBTOTAL_LABEL = /\b(?:subtotal|sub\s*total)\b/i;

const AMOUNT_RE =
  /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/gi;
const BARE_AMOUNT_RE = /\b(\d{1,6}(?:,\d{3})*(?:\.\d{1,2}))\b/g;

const MONTHS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function normalizeLine(line: string): string {
  return line.replace(/[|_*]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeYear(year: string): number {
  const n = Number(year);
  return year.length === 2 ? 2000 + n : n;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseDate(text: string, today: string): string {
  const dayMonthYear =
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,'.-]*(\d{2,4})\b/i.exec(text);
  if (dayMonthYear) {
    const month = MONTHS.get(dayMonthYear[2]!.toLowerCase());
    if (month) {
      const parsed = isoDate(normalizeYear(dayMonthYear[3]!), month, Number(dayMonthYear[1]));
      if (parsed) return parsed;
    }
  }

  const monthDayYear =
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{2,4})\b/i.exec(text);
  if (monthDayYear) {
    const month = MONTHS.get(monthDayYear[1]!.toLowerCase());
    if (month) {
      const parsed = isoDate(normalizeYear(monthDayYear[3]!), month, Number(monthDayYear[2]));
      if (parsed) return parsed;
    }
  }

  const numeric = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/.exec(text);
  if (numeric) {
    const parsed = isoDate(
      normalizeYear(numeric[3]!),
      Number(numeric[2]),
      Number(numeric[1]),
    );
    if (parsed) return parsed;
  }

  return today;
}

function parseCurrencyAmounts(line: string): number[] {
  AMOUNT_RE.lastIndex = 0;
  return Array.from(line.matchAll(AMOUNT_RE))
    .map((match) => Number((match[1] ?? match[2])!.replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0 && amount < 10_000_000);
}

function parseBareAmounts(line: string): number[] {
  BARE_AMOUNT_RE.lastIndex = 0;
  return Array.from(line.matchAll(BARE_AMOUNT_RE))
    .map((match) => Number(match[1]!.replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0 && amount < 10_000_000);
}

function parseLabeledAmounts(lines: string[], label: RegExp): number[] {
  const values: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!label.test(line)) continue;
    values.push(...parseCurrencyAmounts(line), ...parseBareAmounts(line));

    // OCR often splits "Payment Due" and "INR160.00" onto separate lines.
    const next = lines[i + 1];
    if (next) {
      values.push(...parseCurrencyAmounts(next), ...parseBareAmounts(next));
    }
  }
  return values;
}

function highestLabeledAmount(lines: string[], label: RegExp): number | null {
  const values = parseLabeledAmounts(lines, label);
  return values.length > 0 ? Math.max(...values) : null;
}

function parseTotalAmount(lines: string[]): number | null {
  return (
    highestLabeledAmount(lines, STRONG_TOTAL_LABEL) ??
    highestLabeledAmount(lines, TOTAL_LABEL) ??
    highestLabeledAmount(lines, PAYMENT_LABEL) ??
    highestLabeledAmount(lines, SUBTOTAL_LABEL)
  );
}

function extractMerchant(lines: string[]): string | null {
  const junk =
    /\b(?:tax\s+invoice|invoice|gstin|cin|fssai|sac\/hsn|subtotal|sub\s*total|cgst|sgst|payment|amount|total|change|check|cashier|credit\s+card|debit\s+card|take[-\s]?out|thank|please|phone|email|feedback|scan|qr|date|time|m\/s|bill|qty|item)\b/i;
  const merchant = lines.find(
    (line) =>
      /[A-Za-z]/.test(line) &&
      line.length >= 3 &&
      line.length <= 90 &&
      !junk.test(line) &&
      !/^\d/.test(line) &&
      !/@/.test(line),
  );
  return merchant ?? null;
}

function pickCategory(text: string, categories: string[]): string {
  const exact = new Map(categories.map((name) => [name.toLowerCase(), name]));
  const lower = text.toLowerCase();
  if (
    exact.has("food") &&
    /\b(?:take[-\s]?out|restaurant|cafe|coffee|tea|food|meal|water|btl|bottle|pizza|burger|dining|hms\s*host|airport)\b/i.test(
      lower,
    )
  ) {
    return exact.get("food")!;
  }
  return exact.get("other") ?? categories[categories.length - 1] ?? "Other";
}

export function tryParseReceiptText(
  text: string,
  categories: string[],
  today: string,
): ParsedExpense | null {
  if (!text || text.length > 5000 || !RECEIPT_SIGNAL.test(text)) return null;

  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  if (lines.length < 3) return null;

  const amount = parseTotalAmount(lines);
  if (amount === null) return null;

  const merchant = extractMerchant(lines);
  const description = merchant ? `${merchant} receipt` : "Receipt";

  return {
    amount,
    currency: "INR",
    description,
    merchant,
    occurred_at: parseDate(text, today),
    category: pickCategory(text, categories),
  };
}
