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

export interface ExportRow {
  date: string;
  amount_cents: number;
  currency: string;
  category: string;
  merchant: string;
  merchant_canonical: string;
  description: string;
  source: string;
  tags: string[];
}

export async function getExpensesForExport(
  userId: number,
  start: string,
  end: string,
): Promise<ExportRow[]> {
  return sql<ExportRow[]>`
    SELECT
      e.occurred_at::date::text         AS date,
      e.amount_cents::int               AS amount_cents,
      e.currency,
      COALESCE(c.name, 'Uncategorized') AS category,
      COALESCE(e.merchant, '')          AS merchant,
      COALESCE(mc.name, '')             AS merchant_canonical,
      COALESCE(e.description, '')       AS description,
      e.source,
      COALESCE(
        (SELECT array_agg(t.name ORDER BY t.name)
         FROM tags t
         JOIN expense_tags et ON et.tag_id = t.id
         WHERE et.expense_id = e.id),
        ARRAY[]::text[]
      ) AS tags
    FROM expenses e
    LEFT JOIN categories c          ON e.category_id           = c.id
    LEFT JOIN merchants_canonical mc ON e.merchant_canonical_id = mc.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    ORDER BY e.occurred_at ASC
  `;
}

/** Distinct user IDs that have at least one expense in the given range. */
export async function getDistinctUsersWithExpensesIn(
  start: string,
  end: string,
): Promise<number[]> {
  const rows = await sql<Array<{ user_id: number }>>`
    SELECT DISTINCT user_id FROM expenses
    WHERE occurred_at >= ${start}::date
      AND occurred_at < (${end}::date + INTERVAL '1 day')
  `;
  return rows.map((r) => r.user_id);
}
