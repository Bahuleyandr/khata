import { sql } from "./index.js";

export interface SpendTotal {
  total_cents: string;
  currency: string;
  count: number;
}

export interface CategorySpend {
  category: string;
  total_cents: string;
  currency: string;
  count: number;
}

export interface TopExpense {
  id: string;
  description: string;
  merchant: string | null;
  occurred_at: Date;
  amount_cents: string;
  currency: string;
  category: string | null;
}

export async function totalSpendInCategory(
  userId: number,
  category: string | undefined,
  start: string,
  end: string,
): Promise<SpendTotal[]> {
  if (category) {
    return sql<SpendTotal[]>`
      SELECT SUM(e.amount_cents)::text AS total_cents, e.currency, COUNT(*)::int AS count
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.user_id = ${userId}
        AND c.name ILIKE ${category}
        AND e.occurred_at >= ${start}::date
        AND e.occurred_at < (${end}::date + INTERVAL '1 day')
      GROUP BY e.currency
    `;
  }
  return sql<SpendTotal[]>`
    SELECT SUM(e.amount_cents)::text AS total_cents, e.currency, COUNT(*)::int AS count
    FROM expenses e
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    GROUP BY e.currency
  `;
}

export async function topExpenses(
  userId: number,
  start: string,
  end: string,
  limit: number,
): Promise<TopExpense[]> {
  return sql<TopExpense[]>`
    SELECT e.id, e.description, e.merchant, e.occurred_at,
           e.amount_cents::text AS amount_cents, e.currency,
           COALESCE(c.name, 'Uncategorized') AS category
    FROM expenses e
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    ORDER BY e.amount_cents DESC
    LIMIT ${limit}
  `;
}

export async function spendByCategory(
  userId: number,
  start: string,
  end: string,
): Promise<CategorySpend[]> {
  return sql<CategorySpend[]>`
    SELECT COALESCE(c.name, 'Uncategorized') AS category,
           SUM(e.amount_cents)::text AS total_cents, e.currency,
           COUNT(*)::int AS count
    FROM expenses e
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    GROUP BY c.name, e.currency
    ORDER BY SUM(e.amount_cents) DESC
  `;
}
