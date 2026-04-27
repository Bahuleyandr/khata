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
}

export async function insertExpense(data: InsertExpenseData): Promise<string> {
  // Resolve a canonical merchant ID for cross-row aggregation ("how much at
  // Zomato?" works even when the raw `merchant` text is "ZOMATO IN" /
  // "Zomato Order"). Best-effort — null merchant just yields null.
  const merchantCanonicalId = await getOrCreateMerchantCanonical(data.userId, data.merchant);

  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO expenses
      (user_id, amount_cents, currency, description, merchant, merchant_canonical_id,
       category_id, occurred_at, source, raw_text, image_key, content_hash)
    VALUES
      (${data.userId}, ${data.amount_cents}, ${data.currency}, ${data.description},
       ${data.merchant}, ${merchantCanonicalId},
       ${data.category_id}, ${data.occurred_at}, ${data.source}, ${data.raw_text},
       ${data.image_key ?? null}, ${data.content_hash ?? null})
    RETURNING id
  `;
  return row.id;
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
