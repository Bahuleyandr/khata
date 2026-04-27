import { sql } from "./index.js";

export interface Tag {
  id: string;
  name: string;
}

/** Lowercase + collapse internal whitespace for a stable lookup key. */
function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * List the user's tags with how many expenses each is attached to (descending).
 * Empty array if they have none.
 */
export async function listTagsWithCounts(
  userId: number,
): Promise<Array<Tag & { count: number }>> {
  return sql<Array<Tag & { count: number }>>`
    SELECT t.id, t.name, COUNT(et.expense_id)::int AS count
    FROM tags t
    LEFT JOIN expense_tags et ON et.tag_id = t.id
    WHERE t.user_id = ${userId}
    GROUP BY t.id, t.name
    ORDER BY count DESC, t.name ASC
  `;
}

/**
 * Find an existing tag by name or create one. Idempotent.
 */
export async function getOrCreateTag(userId: number, rawName: string): Promise<string | null> {
  const name = normalizeTagName(rawName);
  if (!name) return null;
  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO tags (user_id, name) VALUES (${userId}, ${name})
    ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  return row?.id ?? null;
}

/**
 * Look up a tag by name (does NOT create). Returns null if not found.
 */
export async function findTagByName(userId: number, rawName: string): Promise<Tag | null> {
  const name = normalizeTagName(rawName);
  if (!name) return null;
  const [row] = await sql<Array<Tag>>`
    SELECT id, name FROM tags
    WHERE user_id = ${userId} AND name = ${name}
    LIMIT 1
  `;
  return row ?? null;
}

export async function attachTagToExpense(expenseId: string, tagId: string): Promise<void> {
  await sql`
    INSERT INTO expense_tags (expense_id, tag_id) VALUES (${expenseId}, ${tagId})
    ON CONFLICT DO NOTHING
  `;
}

/** Returns true if a row was deleted. */
export async function detachTagFromExpense(expenseId: string, tagId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM expense_tags
    WHERE expense_id = ${expenseId} AND tag_id = ${tagId}
    RETURNING expense_id
  `;
  return rows.length > 0;
}

export async function getTagsForExpense(expenseId: string): Promise<Tag[]> {
  return sql<Tag[]>`
    SELECT t.id, t.name FROM tags t
    JOIN expense_tags et ON et.tag_id = t.id
    WHERE et.expense_id = ${expenseId}
    ORDER BY t.name
  `;
}

/**
 * Bulk-fetch tags for many expense IDs. Returns a Map<expenseId, tag-names[]>
 * for O(1) lookup when rendering a list. Empty array entries are omitted —
 * caller should default to [].
 */
export async function getTagsForExpenses(
  expenseIds: string[],
): Promise<Map<string, string[]>> {
  if (expenseIds.length === 0) return new Map();
  const rows = await sql<Array<{ expense_id: string; name: string }>>`
    SELECT et.expense_id, t.name
    FROM expense_tags et
    JOIN tags t ON t.id = et.tag_id
    WHERE et.expense_id = ANY(${expenseIds}::uuid[])
    ORDER BY t.name
  `;
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const cur = out.get(r.expense_id) ?? [];
    cur.push(r.name);
    out.set(r.expense_id, cur);
  }
  return out;
}
