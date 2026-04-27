import { sql } from "./index.js";

export interface Budget {
  id: string;
  category_id: string;
  category_name: string;
  target_cents: number;
  period: string;
}

export interface BudgetWithSpend extends Budget {
  spent_cents: number;
  pct: number;
}

export async function setBudget(
  userId: number,
  categoryId: string,
  targetCents: number,
): Promise<void> {
  await sql`
    INSERT INTO category_budgets (user_id, category_id, target_cents, period)
    VALUES (${userId}, ${categoryId}, ${targetCents}, 'monthly')
    ON CONFLICT (user_id, category_id, period)
    DO UPDATE SET target_cents = EXCLUDED.target_cents
  `;
}

export async function listBudgets(userId: number): Promise<Budget[]> {
  const rows = await sql<Array<{ id: string; category_id: string; category_name: string; target_cents: string; period: string }>>`
    SELECT b.id, b.category_id, c.name AS category_name,
           b.target_cents::text AS target_cents, b.period
    FROM category_budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.user_id = ${userId}
    ORDER BY c.name ASC
  `;
  return rows.map((r) => ({ ...r, target_cents: Number(r.target_cents) }));
}

export async function clearBudget(userId: number, categoryId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM category_budgets
    WHERE user_id = ${userId} AND category_id = ${categoryId}
    RETURNING id
  `;
  return result.length > 0;
}

export async function getBudgetsWithMtd(
  userId: number,
  yearMonth: string,
): Promise<BudgetWithSpend[]> {
  const rows = await sql<Array<{
    id: string;
    category_id: string;
    category_name: string;
    target_cents: string;
    spent_cents: string;
  }>>`
    SELECT
      b.id,
      b.category_id,
      c.name AS category_name,
      b.target_cents::text AS target_cents,
      COALESCE(SUM(e.amount_cents), 0)::text AS spent_cents
    FROM category_budgets b
    JOIN categories c ON b.category_id = c.id
    LEFT JOIN expenses e
      ON e.category_id = b.category_id
      AND e.user_id = b.user_id
      AND TO_CHAR(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = ${yearMonth}
    WHERE b.user_id = ${userId}
    GROUP BY b.id, b.category_id, c.name, b.target_cents
  `;
  return rows.map((r) => {
    const target = Number(r.target_cents);
    const spent = Number(r.spent_cents);
    return {
      id: r.id,
      category_id: r.category_id,
      category_name: r.category_name,
      period: "monthly",
      target_cents: target,
      spent_cents: spent,
      pct: target > 0 ? Math.round((spent / target) * 100) : 0,
    };
  });
}

export async function getDistinctUsersWithBudgets(): Promise<number[]> {
  const rows = await sql<Array<{ user_id: string }>>`
    SELECT DISTINCT user_id FROM category_budgets
  `;
  return rows.map((r) => Number(r.user_id));
}

export async function getDigestState(
  userId: number,
  categoryId: string,
  yearMonth: string,
): Promise<number> {
  const [row] = await sql<Array<{ last_threshold_notified: number }>>`
    SELECT last_threshold_notified
    FROM budget_digest_state
    WHERE user_id = ${userId} AND category_id = ${categoryId} AND year_month = ${yearMonth}
  `;
  return row?.last_threshold_notified ?? 0;
}

export async function upsertDigestState(
  userId: number,
  categoryId: string,
  yearMonth: string,
  threshold: number,
): Promise<void> {
  await sql`
    INSERT INTO budget_digest_state (user_id, category_id, year_month, last_threshold_notified)
    VALUES (${userId}, ${categoryId}, ${yearMonth}, ${threshold})
    ON CONFLICT (user_id, category_id, year_month)
    DO UPDATE SET
      last_threshold_notified = EXCLUDED.last_threshold_notified,
      updated_at = NOW()
  `;
}
