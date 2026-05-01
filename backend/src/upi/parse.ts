/**
 * Best-effort regex parser for forwarded UPI / bank-payment confirmation
 * messages. Handles the common Indian app shapes (GPay, PhonePe, Paytm,
 * generic UPI, bank-debit SMS) without going through the LLM — faster,
 * cheaper, more accurate for well-known formats.
 *
 * If no match, returns null and the caller should fall back to LLM parsing.
 *
 * Goal: avoid false positives. We require BOTH:
 *   - An explicit amount (with a currency marker), AND
 *   - A clear "this is a payment" signal (UPI / app name / debit verb).
 * Random text mentioning ₹ won't match.
 */

export interface UpiParse {
  amountRupees: number;
  merchant: string | null;
  app: "gpay" | "phonepe" | "paytm" | "upi" | "bank";
  /**
   * UPI ref / UTR / txn-id when present in the source text. Used as a stable
   * dedup key so the same transaction arriving via two channels (forwarded SMS
   * + photo of the same receipt) collapses to one row. Null when the source
   * doesn't include one — those payments fall through to the existing
   * source-specific dedup (image content_hash, etc.).
   */
  reference: string | null;
  /**
   * Source transaction date when the notification/OCR includes one.
   * ISO date only; callers decide the time-of-day default.
   */
  occurredOn: string | null;
}

const PAYMENT_SIGNAL =
  /\b(?:UPI|IMPS|NEFT|RTGS|GPay|G\s?Pay|Google\s?Pay|PhonePe|Phone\s?Pe|Paytm|debited|credited|transferred|paid\s+to|payment\s+(?:successful|method|amount|through)|bank\s+transfer|request\s+accepted|transaction\s+summary)\b/i;

const CARD_PAYMENT_SIGNAL =
  /\b(?:you(?:'ve|\s+have)?\s+spent|spent|charged|purchase(?:d)?)\b[\s\S]{0,140}\b(?:card|AMEX|American\s+Express|Visa|Mastercard|Master\s?Card|RuPay)\b|\b(?:card|AMEX|American\s+Express|Visa|Mastercard|Master\s?Card|RuPay)\b[\s\S]{0,140}\b(?:spent|charged|purchase(?:d)?)\b/i;

// Allow up to 5 chars of whitespace + punctuation between the currency marker
// and the digits — covers "Rs.500", "Rs 500", "Rs:500", "INR): 11942.89",
// "(INR) 200", "₹ 500", etc. that show up in real bank/app/OCR text.
const AMOUNT_RE =
  /(?:rs\.?|inr|₹|rupees?)[\s\W]{0,5}([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)[\s\W]{0,5}(?:rs\.?|inr|₹|rupees?)/i;

// "to <merchant>" — merchant is letters/numbers/space/&/-/'/. up until a
// terminator (via / on <date> / for / ref / UPI / Acct / period / EOL).
// `on\s+\d` is intentionally outside the \b-anchored group: \b doesn't fire
// between consecutive digits, so the date branch needs its own form.
const TO_MERCHANT_RE =
  /\bto\s+([A-Z][\w\s.&'@-]{1,80}?)(?=\s+(?:via|using|through|from|UPI|IMPS|NEFT|RTGS|ref|on\s+account|account|a\/c|savings)\b|\s+on\s+\d|\s*[.\n]|$)/i;

const AT_MERCHANT_RE =
  /\bat\s+([A-Z][\w\s.&'@-]{1,80}?)(?=\s+(?:on|at\s+\d|for|via|using|through|ref|rrn|txn|transaction|if|call)\b|\s*[.\n]|$)/i;

const PAID_TO_MERCHANT_RE =
  /\bpaid\s+to\s*[:\-]?\s*([A-Z][\w\s.&'@-]{1,100}?)(?=\s+(?:Indian|Savings|A\/c|Acct|Account|Paid\s+By|Payment\s+Method|Bank\s+Transfer|UPI|IMPS|NEFT|RTGS|HDFC|ICICI|SBI|Axis|Kotak)\b|[\n\r]|$)/i;

// UPI ref / UTR / txn-id capture. Common shapes seen in real bank SMS and
// receipt OCR:
//   "Ref 112749168520"           (HDFC UPI debit SMS)
//   "Transaction Identification Number: CHD53OR1IHJ2Z1"  (AmEx receipt)
//   "UTR: HDFC0000123456"
//   "RRN 123456789012"
//   "Txn ID: ABC12345"
// 6-char floor on the captured token avoids matching short noise; the
// preceding label keyword keeps it specific to actual ref fields.
const REF_RE =
  /\b(?:ref(?:erence)?|utr|rrn|txn|transaction)(?:\s+(?:no\.?|id|identification(?:\s+number)?|number|#))?[\s:.#]+([A-Z0-9]{6,})\b/i;

const REF_RE_PRIORITY = [
  /\b(?:ref(?:erence)?|utr|rrn)(?:\s+(?:no\.?|id|number|#))?[\s:.#]+([A-Z0-9]{6,})\b/i,
  /\b(?:txn|transaction)(?:\s+(?:no\.?|id|identification(?:\s+number)?|number|#))?[\s:.#]+([A-Z0-9]{6,})\b/i,
] as const;

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

function detectApp(text: string): UpiParse["app"] {
  if (/G\s?Pay|Google\s?Pay/i.test(text)) return "gpay";
  if (/Phone\s?Pe/i.test(text)) return "phonepe";
  if (/Paytm/i.test(text)) return "paytm";
  if (CARD_PAYMENT_SIGNAL.test(text)) return "bank";
  if (/\b(?:IMPS|NEFT|RTGS|bank\s+transfer|savings\s+a\/c|acct|account)\b/i.test(text)) return "bank";
  if (/A\/c|Acct|account/i.test(text) && /(?:debited|credited)/i.test(text)) return "bank";
  return "upi";
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

function parseSourceDate(text: string): string | null {
  const dayMonthYear =
    /\b(?:on|date|dated|payment\s+date|request\s+accepted)?\s*:?\s*(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,.-]+(\d{2,4})\b/i.exec(text);
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

  return null;
}

function parseReference(text: string): string | null {
  for (const re of REF_RE_PRIORITY) {
    const match = re.exec(text);
    if (match?.[1]) return match[1].toUpperCase();
  }
  const fallback = REF_RE.exec(text);
  return fallback?.[1]?.toUpperCase() ?? null;
}

export function tryParseUpi(text: string): UpiParse | null {
  if (!text || text.length > 2000) return null; // guard against pathological inputs
  if (!PAYMENT_SIGNAL.test(text) && !CARD_PAYMENT_SIGNAL.test(text)) return null;

  const amtMatch = AMOUNT_RE.exec(text);
  if (!amtMatch) return null;
  const amountStr = (amtMatch[1] ?? amtMatch[2])!.replace(/,/g, "");
  const amountRupees = parseFloat(amountStr);
  if (isNaN(amountRupees) || amountRupees <= 0 || amountRupees > 10_000_000) return null;

  const merchMatch =
    PAID_TO_MERCHANT_RE.exec(text) ?? TO_MERCHANT_RE.exec(text) ?? AT_MERCHANT_RE.exec(text);
  const merchant = merchMatch?.[1]?.trim().replace(/\s+/g, " ") ?? null;

  return {
    amountRupees,
    merchant: merchant && merchant.length >= 2 ? merchant : null,
    app: detectApp(text),
    reference: parseReference(text),
    occurredOn: parseSourceDate(text),
  };
}
