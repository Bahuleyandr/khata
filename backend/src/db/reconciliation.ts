import { sql } from "./index.js";

export type ReconciliationStatus =
  | "matched"
  | "missing_in_khata"
  | "missing_in_statement"
  | "amount_mismatch";

export interface ReconciliationItem {
  status: ReconciliationStatus;
  expense_id: string | null;
  statement_row_id: string | null;
  occurred_at: string;
  description: string;
  amount_cents: string;
  statement_amount_cents: string | null;
  currency: string;
  account_id: string | null;
  account: string | null;
  amount_delta_cents: string;
}

export interface ReconciliationSummary {
  period: {
    year: number;
    month: number;
    start: string;
    end: string;
    label: string;
  };
  account_id: string | null;
  account: string | null;
  expense_count: number;
  statement_count: number;
  matched_count: number;
  missing_in_khata: number;
  missing_in_statement: number;
  amount_mismatch: number;
  total_expense_cents: string;
  total_statement_cents: string;
}

export interface ReconciliationResult {
  summary: ReconciliationSummary;
  items: ReconciliationItem[];
}

function monthBounds(year: number, month: number): { start: string; end: string; label: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = endDate.toISOString().slice(0, 10);
  const label = endDate.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

export async function computeMonthlyReconciliation(
  userId: number,
  year: number,
  month: number,
  accountId?: string | null,
): Promise<ReconciliationResult> {
  const bounds = monthBounds(year, month);
  const accountFilter = accountId ?? null;

  const [expenseAggregate, statementAggregate, account] = await Promise.all([
    sql<Array<{ count: string; total_cents: string }>>`
      SELECT COUNT(*)::text AS count,
             COALESCE(SUM(amount_cents), 0)::text AS total_cents
      FROM expenses
      WHERE user_id = ${userId}
        AND occurred_at >= ${bounds.start}::date
        AND occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        AND (${accountFilter}::uuid IS NULL OR account_id = ${accountFilter}::uuid)
    `,
    sql<Array<{ count: string; total_cents: string }>>`
      SELECT COUNT(*)::text AS count,
             COALESCE(SUM(r.amount_cents), 0)::text AS total_cents
      FROM statement_import_rows r
      LEFT JOIN statements s ON s.id = r.statement_id AND s.user_id = r.user_id
      WHERE r.user_id = ${userId}
        AND r.occurred_at >= ${bounds.start}::date
        AND r.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        AND r.status IN ('pending', 'imported', 'duplicate')
        AND (
          ${accountFilter}::uuid IS NULL
          OR r.account_id = ${accountFilter}::uuid
          OR (r.account_id IS NULL AND s.account_id = ${accountFilter}::uuid)
        )
    `,
    accountFilter
      ? sql<Array<{ id: string; name: string }>>`
          SELECT id, name
          FROM accounts
          WHERE id = ${accountFilter}
            AND user_id = ${userId}
          LIMIT 1
        `
      : Promise.resolve([]),
  ]);

  type Row = ReconciliationItem & { sort_at: string; sort_amount: string };
  const rows = await sql<Row[]>`
    WITH expense_scope AS (
      SELECT e.id,
             e.occurred_at::date AS occurred_at,
             COALESCE(e.merchant, e.description, 'Expense') AS description,
             e.amount_cents,
             e.currency,
             e.account_id,
             a.name AS account
      FROM expenses e
      LEFT JOIN accounts a ON a.id = e.account_id AND a.user_id = e.user_id
      WHERE e.user_id = ${userId}
        AND e.occurred_at >= ${bounds.start}::date
        AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        AND (${accountFilter}::uuid IS NULL OR e.account_id = ${accountFilter}::uuid)
    ),
    row_scope AS (
      SELECT r.id,
             r.occurred_at::date AS occurred_at,
             r.description,
             r.amount_cents,
             r.currency,
             COALESCE(r.account_id, s.account_id) AS account_id,
             a.name AS account,
             r.status,
             r.imported_expense_id,
             r.matched_expense_id
      FROM statement_import_rows r
      LEFT JOIN statements s ON s.id = r.statement_id AND s.user_id = r.user_id
      LEFT JOIN accounts a ON a.id = COALESCE(r.account_id, s.account_id) AND a.user_id = r.user_id
      WHERE r.user_id = ${userId}
        AND r.occurred_at >= ${bounds.start}::date
        AND r.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        AND r.status IN ('pending', 'imported', 'duplicate')
        AND (
          ${accountFilter}::uuid IS NULL
          OR r.account_id = ${accountFilter}::uuid
          OR (r.account_id IS NULL AND s.account_id = ${accountFilter}::uuid)
        )
    ),
    direct_matches AS (
      SELECT e.id AS expense_id,
             r.id AS statement_row_id,
             e.occurred_at,
             e.description,
             e.amount_cents,
             r.amount_cents AS statement_amount_cents,
             e.currency,
             COALESCE(e.account_id, r.account_id) AS account_id,
             COALESCE(e.account, r.account) AS account,
             (e.amount_cents - r.amount_cents) AS amount_delta_cents,
             CASE WHEN e.amount_cents = r.amount_cents THEN 'matched' ELSE 'amount_mismatch' END AS status
      FROM row_scope r
      JOIN expense_scope e
        ON e.id = r.imported_expense_id
        OR e.id = r.matched_expense_id
    ),
    fuzzy_matches AS (
      SELECT DISTINCT ON (e.id)
             e.id AS expense_id,
             r.id AS statement_row_id,
             e.occurred_at,
             e.description,
             e.amount_cents,
             r.amount_cents AS statement_amount_cents,
             e.currency,
             COALESCE(e.account_id, r.account_id) AS account_id,
             COALESCE(e.account, r.account) AS account,
             (e.amount_cents - r.amount_cents) AS amount_delta_cents,
             'matched' AS status
      FROM expense_scope e
      JOIN row_scope r
        ON e.amount_cents = r.amount_cents
       AND ABS(e.occurred_at - r.occurred_at) <= 2
       AND NOT EXISTS (
         SELECT 1 FROM direct_matches dm
         WHERE dm.expense_id = e.id OR dm.statement_row_id = r.id
       )
      ORDER BY e.id, ABS(e.occurred_at - r.occurred_at), r.id
    ),
    all_matches AS (
      SELECT * FROM direct_matches
      UNION ALL
      SELECT * FROM fuzzy_matches
    ),
    missing_in_khata AS (
      SELECT NULL::uuid AS expense_id,
             r.id AS statement_row_id,
             r.occurred_at,
             r.description,
             r.amount_cents,
             r.amount_cents AS statement_amount_cents,
             r.currency,
             r.account_id,
             r.account,
             (-r.amount_cents) AS amount_delta_cents,
             'missing_in_khata' AS status
      FROM row_scope r
      WHERE NOT EXISTS (
        SELECT 1 FROM all_matches m WHERE m.statement_row_id = r.id
      )
    ),
    missing_in_statement AS (
      SELECT e.id AS expense_id,
             NULL::uuid AS statement_row_id,
             e.occurred_at,
             e.description,
             e.amount_cents,
             NULL::bigint AS statement_amount_cents,
             e.currency,
             e.account_id,
             e.account,
             e.amount_cents AS amount_delta_cents,
             'missing_in_statement' AS status
      FROM expense_scope e
      WHERE NOT EXISTS (
        SELECT 1 FROM all_matches m WHERE m.expense_id = e.id
      )
    ),
    combined AS (
      SELECT * FROM all_matches
      UNION ALL
      SELECT * FROM missing_in_khata
      UNION ALL
      SELECT * FROM missing_in_statement
    )
    SELECT status,
           expense_id::text AS expense_id,
           statement_row_id::text AS statement_row_id,
           occurred_at::text AS occurred_at,
           description,
           amount_cents::text AS amount_cents,
           statement_amount_cents::text AS statement_amount_cents,
           currency,
           account_id::text AS account_id,
           account,
           amount_delta_cents::text AS amount_delta_cents,
           occurred_at::text AS sort_at,
           amount_cents::text AS sort_amount
    FROM combined
    ORDER BY occurred_at DESC, amount_cents DESC
    LIMIT 500
  `;

  const items = rows.map(({ sort_at: _sortAt, sort_amount: _sortAmount, ...row }) => row);
  const summary = {
    period: {
      year,
      month,
      start: bounds.start,
      end: bounds.end,
      label: bounds.label,
    },
    account_id: accountFilter,
    account: account[0]?.name ?? null,
    expense_count: Number(expenseAggregate[0]?.count ?? 0),
    statement_count: Number(statementAggregate[0]?.count ?? 0),
    matched_count: items.filter((item) => item.status === "matched").length,
    missing_in_khata: items.filter((item) => item.status === "missing_in_khata").length,
    missing_in_statement: items.filter((item) => item.status === "missing_in_statement").length,
    amount_mismatch: items.filter((item) => item.status === "amount_mismatch").length,
    total_expense_cents: expenseAggregate[0]?.total_cents ?? "0",
    total_statement_cents: statementAggregate[0]?.total_cents ?? "0",
  };

  return { summary, items };
}
