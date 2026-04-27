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

// ── Helpers used by the chat-with-data agent ────────────────────────────────

export interface MerchantSpend {
  merchant: string;
  total_cents: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

/**
 * Find recurring expenses — merchants charged at least N times in the last
 * `lookback_months` months, ordered by occurrence count desc. Useful for
 * subscription detection.
 */
export async function findRecurring(
  userId: number,
  lookbackMonths: number,
  minOccurrences: number,
): Promise<MerchantSpend[]> {
  return sql<MerchantSpend[]>`
    SELECT
      COALESCE(mc.name, e.merchant, '(unknown)') AS merchant,
      SUM(e.amount_cents)::text                  AS total_cents,
      COUNT(*)::int                              AS count,
      MIN(e.occurred_at)::date::text             AS first_seen,
      MAX(e.occurred_at)::date::text             AS last_seen
    FROM expenses e
    LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= NOW() - (${lookbackMonths} || ' months')::interval
      AND COALESCE(mc.name, e.merchant) IS NOT NULL
    GROUP BY merchant
    HAVING COUNT(*) >= ${minOccurrences}
    ORDER BY count DESC, total_cents DESC
    LIMIT 50
  `;
}

export interface ExpenseAtMerchant {
  id: string;
  occurred_at: string;
  amount_cents: string;
  currency: string;
  description: string | null;
  merchant: string | null;
  category: string;
}

/**
 * Find expenses where the raw or canonical merchant matches the given
 * substring (case-insensitive ILIKE). Newest first.
 */
export async function findExpensesAtMerchant(
  userId: number,
  merchantSubstring: string,
  start: string,
  end: string,
  limit: number = 50,
): Promise<ExpenseAtMerchant[]> {
  const pattern = `%${merchantSubstring}%`;
  return sql<ExpenseAtMerchant[]>`
    SELECT
      e.id,
      e.occurred_at::date::text         AS occurred_at,
      e.amount_cents::text              AS amount_cents,
      e.currency,
      e.description,
      e.merchant,
      COALESCE(c.name, 'Uncategorized') AS category
    FROM expenses e
    LEFT JOIN categories c           ON c.id  = e.category_id
    LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
      AND (e.merchant ILIKE ${pattern} OR mc.name ILIKE ${pattern})
    ORDER BY e.occurred_at DESC
    LIMIT ${limit}
  `;
}
