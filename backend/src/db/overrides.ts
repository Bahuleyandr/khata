import { sql } from "./index.js";

export interface CategoryOverride {
  hint_text: string;
  category_name: string;
}

export async function getOverrides(userId: number): Promise<CategoryOverride[]> {
  return sql<CategoryOverride[]>`
    SELECT hint_text, category_name FROM category_overrides
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 30
  `;
}

export async function upsertOverride(
  userId: number,
  hintText: string,
  categoryName: string,
): Promise<void> {
  await sql`
    INSERT INTO category_overrides (user_id, hint_text, category_name)
    VALUES (${userId}, ${hintText}, ${categoryName})
    ON CONFLICT (user_id, hint_text)
    DO UPDATE SET category_name = ${categoryName}
  `;
}
