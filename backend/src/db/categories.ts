import { sql } from "./index.js";

const DEFAULT_CATEGORIES = [
  "Food",
  "Transport",
  "Groceries",
  "Bills",
  "Shopping",
  "Entertainment",
  "Health",
  "Other",
];

export async function seedDefaultCategories(userId: number): Promise<void> {
  for (const name of DEFAULT_CATEGORIES) {
    await sql`
      INSERT INTO categories (user_id, name, is_default)
      VALUES (${userId}, ${name}, true)
      ON CONFLICT (user_id, name) DO NOTHING
    `;
  }
}

export async function getUserCategories(
  userId: number,
): Promise<Array<{ id: string; name: string }>> {
  return sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM categories
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, name ASC
  `;
}

export async function getCategoryByName(
  userId: number,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM categories
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${name})
  `;
  return row ?? null;
}

export async function renameCategory(
  userId: number,
  oldName: string,
  newName: string,
): Promise<boolean> {
  const result = await sql`
    UPDATE categories
    SET name = ${newName}
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${oldName})
    RETURNING id
  `;
  return result.length > 0;
}

export async function addCategory(userId: number, name: string): Promise<boolean> {
  try {
    await sql`
      INSERT INTO categories (user_id, name, is_default)
      VALUES (${userId}, ${name}, false)
    `;
    return true;
  } catch {
    return false; // unique constraint violation
  }
}

export async function deleteCategory(userId: number, name: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM categories
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${name}) AND is_default = false
    RETURNING id
  `;
  return result.length > 0;
}
