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
