import { sql } from "../db/index.js";
import type { DedupeResult, ParsedTransaction } from "./types.js";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE_CENTS = 50; // ±$0.50 / ₹0.50

function wordOverlapScore(a: string, b: string): number {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

interface ExpenseRow {
  id: string;
  amount_cents: bigint;
  occurred_at: Date;
  description: string | null;
  merchant: string | null;
}

export async function dedupeTransactions(
  userId: number,
  transactions: ParsedTransaction[],
): Promise<DedupeResult[]> {
  if (transactions.length === 0) return [];

  // Fetch candidate expenses within the widest date window from the statement
  const dates = transactions.map((t) => new Date(t.date));
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())) - TWO_DAYS_MS);
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())) + TWO_DAYS_MS);

  const candidates = await sql<ExpenseRow[]>`
    SELECT id, amount_cents, occurred_at, description, merchant
    FROM expenses
    WHERE user_id = ${userId}
      AND occurred_at BETWEEN ${minDate} AND ${maxDate}
  `;

  return transactions.map((tx) => {
    const txDate = new Date(tx.date).getTime();
    const txDesc = tx.description ?? "";

    const match = candidates.find((row) => {
      const amountDiff = Math.abs(Number(row.amount_cents) - tx.amountCents);
      if (amountDiff > AMOUNT_TOLERANCE_CENTS) return false;

      const dateDiff = Math.abs(row.occurred_at.getTime() - txDate);
      if (dateDiff > TWO_DAYS_MS) return false;

      const candidateDesc = [row.description, row.merchant].filter(Boolean).join(" ");
      return wordOverlapScore(txDesc, candidateDesc) >= 0.4;
    });

    return {
      transaction: tx,
      alreadyLogged: !!match,
      matchedExpenseId: match?.id,
    };
  });
}
