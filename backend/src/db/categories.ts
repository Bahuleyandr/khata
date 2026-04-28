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

function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function seedDefaultCategories(userId: number): Promise<void> {
  for (const name of DEFAULT_CATEGORIES) {
    await sql`
    INSERT INTO categories (user_id, name, is_default)
    VALUES (${userId}, ${name}, true)
    ON CONFLICT DO NOTHING
  `;
  }
}

export async function getUserCategories(
  userId: number,
): Promise<Array<{ id: string; name: string; is_default: boolean }>> {
  return sql<Array<{ id: string; name: string; is_default: boolean }>>`
    SELECT id, name, is_default FROM categories
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, name ASC
  `;
}

export async function getCategoryByName(
  userId: number,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const display = normalizeCategoryName(name);
  if (!display) return null;
  const [row] = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM categories
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${display})
  `;
  return row ?? null;
}

export async function renameCategory(
  userId: number,
  oldName: string,
  newName: string,
): Promise<boolean> {
  const oldDisplay = normalizeCategoryName(oldName);
  const newDisplay = normalizeCategoryName(newName);
  if (!oldDisplay || !newDisplay) return false;
  const result = await sql`
    UPDATE categories
    SET name = ${newDisplay}
    WHERE user_id = ${userId}
      AND LOWER(name) = LOWER(${oldDisplay})
      AND NOT EXISTS (
        SELECT 1 FROM categories existing
        WHERE existing.user_id = ${userId}
          AND LOWER(existing.name) = LOWER(${newDisplay})
          AND LOWER(existing.name) <> LOWER(${oldDisplay})
      )
    RETURNING id
  `;
  return result.length > 0;
}

export async function addCategory(userId: number, name: string): Promise<boolean> {
  const display = normalizeCategoryName(name);
  if (!display) return false;
  const result = await sql`
    INSERT INTO categories (user_id, name, is_default)
    VALUES (${userId}, ${display}, false)
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return result.length > 0;
}

export async function addCategoryRow(
  userId: number,
  name: string,
): Promise<{ id: string; name: string; is_default: boolean } | null> {
  const display = normalizeCategoryName(name);
  if (!display) return null;
  const [row] = await sql<Array<{ id: string; name: string; is_default: boolean }>>`
    INSERT INTO categories (user_id, name, is_default)
    VALUES (${userId}, ${display}, false)
    ON CONFLICT DO NOTHING
    RETURNING id, name, is_default
  `;
  return row ?? null;
}

export async function renameCategoryById(
  userId: number,
  id: string,
  newName: string,
): Promise<{ id: string; name: string; is_default: boolean } | null> {
  const newDisplay = normalizeCategoryName(newName);
  if (!newDisplay) return null;
  const [row] = await sql<Array<{ id: string; name: string; is_default: boolean }>>`
    UPDATE categories
    SET name = ${newDisplay}
    WHERE id = ${id}
      AND user_id = ${userId}
    RETURNING id, name, is_default
  `;
  return row ?? null;
}

export async function deleteCategoryById(userId: number, id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM categories
    WHERE id = ${id} AND user_id = ${userId} AND is_default = false
    RETURNING id
  `;
  return result.length > 0;
}

export async function deleteCategory(userId: number, name: string): Promise<boolean> {
  const display = normalizeCategoryName(name);
  if (!display) return false;
  const result = await sql`
    DELETE FROM categories
    WHERE user_id = ${userId} AND LOWER(name) = LOWER(${display}) AND is_default = false
    RETURNING id
  `;
  return result.length > 0;
}
