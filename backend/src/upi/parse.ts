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
}

const PAYMENT_SIGNAL =
  /\b(?:UPI|GPay|G\s?Pay|Google\s?Pay|PhonePe|Phone\s?Pe|Paytm|debited|credited|transferred|payment\s+successful)\b/i;

const AMOUNT_RE =
  /(?:rs\.?|inr|₹|rupees?)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹|rupees?)/i;

// "to <merchant>" — merchant is letters/numbers/space/&/-/'/. up until a
// terminator (via / on <date> / for / ref / UPI / Acct / period / EOL).
// `on\s+\d` is intentionally outside the \b-anchored group: \b doesn't fire
// between consecutive digits, so the date branch needs its own form.
const TO_MERCHANT_RE =
  /\bto\s+([A-Z][\w\s.&'@-]{1,60}?)(?=\s+(?:via|using|through|from|UPI|ref|on\s+account|account|a\/c)\b|\s+on\s+\d|\s*[.\n]|$)/i;

function detectApp(text: string): UpiParse["app"] {
  if (/G\s?Pay|Google\s?Pay/i.test(text)) return "gpay";
  if (/Phone\s?Pe/i.test(text)) return "phonepe";
  if (/Paytm/i.test(text)) return "paytm";
  if (/A\/c|Acct|account/i.test(text) && /(?:debited|credited)/i.test(text)) return "bank";
  return "upi";
}

export function tryParseUpi(text: string): UpiParse | null {
  if (!text || text.length > 2000) return null; // guard against pathological inputs
  if (!PAYMENT_SIGNAL.test(text)) return null;

  const amtMatch = AMOUNT_RE.exec(text);
  if (!amtMatch) return null;
  const amountStr = (amtMatch[1] ?? amtMatch[2])!.replace(/,/g, "");
  const amountRupees = parseFloat(amountStr);
  if (isNaN(amountRupees) || amountRupees <= 0 || amountRupees > 10_000_000) return null;

  const merchMatch = TO_MERCHANT_RE.exec(text);
  const merchant = merchMatch?.[1]?.trim().replace(/\s+/g, " ") ?? null;

  return {
    amountRupees,
    merchant: merchant && merchant.length >= 2 ? merchant : null,
    app: detectApp(text),
  };
}
