import { sql } from "./index.js";

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
}

export async function insertExpense(data: InsertExpenseData): Promise<string> {
  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO expenses
      (user_id, amount_cents, currency, description, merchant, category_id, occurred_at, source, raw_text)
    VALUES
      (${data.userId}, ${data.amount_cents}, ${data.currency}, ${data.description},
       ${data.merchant}, ${data.category_id}, ${data.occurred_at}, ${data.source}, ${data.raw_text})
    RETURNING id
  `;
  return row.id;
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
