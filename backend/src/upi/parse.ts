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
}

const PAYMENT_SIGNAL =
  /\b(?:UPI|GPay|G\s?Pay|Google\s?Pay|PhonePe|Phone\s?Pe|Paytm|debited|credited|transferred|payment\s+successful)\b/i;

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
  /\bto\s+([A-Z][\w\s.&'@-]{1,60}?)(?=\s+(?:via|using|through|from|UPI|ref|on\s+account|account|a\/c)\b|\s+on\s+\d|\s*[.\n]|$)/i;

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

  const refMatch = REF_RE.exec(text);
  const reference = refMatch?.[1]?.toUpperCase() ?? null;

  return {
    amountRupees,
    merchant: merchant && merchant.length >= 2 ? merchant : null,
    app: detectApp(text),
    reference,
  };
}
