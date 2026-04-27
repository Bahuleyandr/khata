import { sql } from "./index.js";

/**
 * First-cut canonical merchant: case-insensitive exact match (lowercased,
 * whitespace collapsed). Returns the canonical merchant ID for use as
 * `expenses.merchant_canonical_id`. Returns null if the input is empty.
 *
 * The stored canonical name preserves the *original casing* of whichever
 * merchant string first created the canonical entry — so "Zomato" stays
 * pretty even if a later "ZOMATO IN" matches it. Lookup is case-insensitive
 * via `lower(name)`.
 *
 * Future iteration can layer pg_trgm fuzzy matching (e.g. "Zomato Order"
 * matches "Zomato") on top of this without changing the call site.
 */
export async function getOrCreateMerchantCanonical(
  userId: number,
  rawMerchant: string | null,
): Promise<string | null> {
  if (!rawMerchant) return null;
  const display = rawMerchant.trim().replace(/\s+/g, " ");
  if (!display) return null;
  const lookup = display.toLowerCase();

  const [existing] = await sql<Array<{ id: string }>>`
    SELECT id FROM merchants_canonical
    WHERE user_id = ${userId} AND lower(name) = ${lookup}
    LIMIT 1
  `;
  if (existing?.id) return existing.id;

  const [created] = await sql<Array<{ id: string }>>`
    INSERT INTO merchants_canonical (user_id, name) VALUES (${userId}, ${display})
    ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  return created?.id ?? null;
}

/**
 * Returns the remembered category_id for a canonical merchant, or null if no
 * memory has been written yet. Used by the new-expense flow to skip the LLM's
 * category guess when we already know what the user prefers for this merchant.
 */
export async function getMerchantCategory(
  userId: number,
  merchantCanonicalId: string,
): Promise<string | null> {
  const [row] = await sql<Array<{ category_id: string | null }>>`
    SELECT category_id FROM merchants_canonical
    WHERE id = ${merchantCanonicalId} AND user_id = ${userId}
    LIMIT 1
  `;
  return row?.category_id ?? null;
}

/**
 * Persists the user's category choice for a canonical merchant. Called from
 * the "category: X" reply and the inline keyboard category-pick callback —
 * these are the explicit-correction signals we trust most.
 */
export async function setMerchantCategory(
  userId: number,
  merchantCanonicalId: string,
  categoryId: string,
): Promise<void> {
  await sql`
    UPDATE merchants_canonical
    SET category_id = ${categoryId}
    WHERE id = ${merchantCanonicalId} AND user_id = ${userId}
  `;
}

/**
 * Convenience: takes a raw (possibly noisy) merchant string and returns the
 * remembered category, going through the canonical-merchant lookup. Returns
 * null if there's no merchant or no memory.
 *
 * Two SQL roundtrips per call (canonical resolve, then category lookup); fine
 * for this app's volume.
 */
export async function getLearnedCategoryForMerchant(
  userId: number,
  rawMerchant: string | null,
): Promise<string | null> {
  if (!rawMerchant) return null;
  const canonicalId = await getOrCreateMerchantCanonical(userId, rawMerchant);
  if (!canonicalId) return null;
  return getMerchantCategory(userId, canonicalId);
}

/**
 * Reads back the canonical merchant id that was attached to a previously
 * inserted expense. Used after an explicit category correction so we can
 * write the merchant memory without needing the raw merchant string in the
 * caller's scope.
 */
export async function getMerchantCanonicalIdForExpense(
  userId: number,
  expenseId: string,
): Promise<string | null> {
  const [row] = await sql<Array<{ merchant_canonical_id: string | null }>>`
    SELECT merchant_canonical_id FROM expenses
    WHERE id = ${expenseId} AND user_id = ${userId}
    LIMIT 1
  `;
  return row?.merchant_canonical_id ?? null;
}
