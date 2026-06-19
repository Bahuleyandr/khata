import type { ParsedTransaction } from "./types.js";

/**
 * Validate LLM-extracted rows before they reach the BIGINT amount_cents column.
 * Drops any row whose amountCents is not a positive, finite integer: a single
 * bad value previously aborted the WHOLE import with 22P02, and a negative was
 * silently subtracted from totals. Credits/refunds (<= 0) are skipped — this is
 * a positive-spend tracker, not a ledger of signed movements (audit 2026-06-19 M8).
 *
 * Kept dependency-free (no LLM/config imports) so it is cheap to unit-test.
 */
export function sanitizeParsedTransactions(parsed: unknown[]): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const amountCents = r["amountCents"];
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
      continue;
    }
    const date = r["date"];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      description: typeof r["description"] === "string" ? r["description"] : "",
      amountCents,
      currency: typeof r["currency"] === "string" && r["currency"] ? r["currency"] : "INR",
      suggestedCategory: typeof r["suggestedCategory"] === "string" ? r["suggestedCategory"] : "",
    });
  }
  return out;
}
