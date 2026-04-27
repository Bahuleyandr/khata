import { sql } from "./index.js";
import { getOrCreateMerchantCanonical } from "./merchants.js";

export interface InsertExpenseData {
  userId: number;
  amount_cents: number;
  currency: string;
  description: string | null;
  merchant: string | null;
  category_id: string | null;
  occurred_at: Date;
  source: string;
  raw_text: string | null;
  image_key?: string | null;
  content_hash?: string | null;
  upi_reference_id?: string | null;
}

export async function insertExpense(data: InsertExpenseData): Promise<string> {
  // Resolve a canonical merchant ID for cross-row aggregation ("how much at
  // Zomato?" works even when the raw `merchant` text is "ZOMATO IN" /
  // "Zomato Order"). Best-effort — null merchant just yields null.
  const merchantCanonicalId = await getOrCreateMerchantCanonical(data.userId, data.merchant);

  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO expenses
      (user_id, amount_cents, currency, description, merchant, merchant_canonical_id,
       category_id, occurred_at, source, raw_text, image_key, content_hash,
       upi_reference_id)
    VALUES
      (${data.userId}, ${data.amount_cents}, ${data.currency}, ${data.description},
       ${data.merchant}, ${merchantCanonicalId},
       ${data.category_id}, ${data.occurred_at}, ${data.source}, ${data.raw_text},
       ${data.image_key ?? null}, ${data.content_hash ?? null},
       ${data.upi_reference_id ?? null})
    RETURNING id
  `;
  return row.id;
}

/**
 * Returns true if the user has logged at least one expense today (by
 * `occurred_at::date`). Used by the nightly nudge cron — skip the nudge
 * if they've already logged something today.
 */
export async function userHasExpenseToday(userId: number): Promise<boolean> {
  const [row] = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM expenses
      WHERE user_id = ${userId}
        AND occurred_at::date = CURRENT_DATE
    ) AS exists
  `;
  return row?.exists ?? false;
}

export async function findExpenseByContentHash(
  userId: number,
  contentHash: string,
): Promise<string | null> {
  const result = await sql<Array<{ id: string }>>`
    SELECT id FROM expenses
    WHERE user_id = ${userId} AND content_hash = ${contentHash}
    LIMIT 1
  `;
  return result[0]?.id ?? null;
}

export interface ExpenseDedupRow {
  id: string;
  image_key: string | null;
  content_hash: string | null;
}

export async function findExpenseByUpiRef(
  userId: number,
  upiReferenceId: string,
): Promise<ExpenseDedupRow | null> {
  const result = await sql<Array<ExpenseDedupRow>>`
    SELECT id, image_key, content_hash FROM expenses
    WHERE user_id = ${userId} AND upi_reference_id = ${upiReferenceId}
    LIMIT 1
  `;
  return result[0] ?? null;
}

/**
 * Attach a receipt image to an existing expense row that doesn't yet have one.
 * Used when a UPI SMS was logged first (no image) and then the user photographs
 * the same receipt (matched by upi_reference_id). Best-effort: if the
 * `expenses_user_content_hash_unique` index rejects the attach (the same image
 * was already attached to a different row somehow), the caller can fall back
 * to a plain dedup acknowledgement.
 */
export async function attachReceiptToExpense(
  id: string,
  userId: number,
  imageKey: string,
  contentHash: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE expenses
    SET image_key = ${imageKey}, content_hash = ${contentHash}
    WHERE id = ${id} AND user_id = ${userId}
      AND image_key IS NULL
    RETURNING id
  `;
  return result.length > 0;
}

export async function updateExpenseAmount(
  id: string,
  userId: number,
  amount_cents: number,
  currency: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE expenses SET amount_cents = ${amount_cents}, currency = ${currency}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `;
  return result.length > 0;
}

export async function updateExpenseCategory(
  id: string,
  userId: number,
  category_id: string | null,
): Promise<boolean> {
  const result = await sql`
    UPDATE expenses SET category_id = ${category_id}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `;
  return result.length > 0;
}

export async function updateExpenseDate(
  id: string,
  userId: number,
  occurred_at: Date,
): Promise<boolean> {
  const result = await sql`
    UPDATE expenses SET occurred_at = ${occurred_at}
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `;
  return result.length > 0;
}
