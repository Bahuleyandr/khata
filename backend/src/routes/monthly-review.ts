import type { FastifyInstance } from "fastify";
import { getBudgetsWithMtd } from "../db/budgets.js";
import { sql } from "../db/index.js";
import { currentMonthBounds } from "../export/xlsx.js";
import { getSession } from "./auth.js";

type MonthlyReviewQuery = {
  year?: number;
  month?: number;
};

type ReviewTask = {
  id: "uncategorized" | "receipts" | "duplicates" | "statements" | "budgets" | "export";
  label: string;
  detail: string;
  count: number;
  amount_cents?: string;
  status: "done" | "attention" | "ready";
  href: string;
};

const monthlyReviewQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
  },
} as const;

function selectedMonth(query: MonthlyReviewQuery): { year: number; month: number } {
  const now = new Date();
  return {
    year: query.year ?? now.getFullYear(),
    month: query.month ?? now.getMonth() + 1,
  };
}

function monthProgress(year: number, month: number): { elapsedDays: number; daysInMonth: number } {
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  return {
    elapsedDays: isCurrentMonth ? Math.max(1, Math.min(now.getDate(), daysInMonth)) : daysInMonth,
    daysInMonth,
  };
}

function txHref(bounds: { start: string; end: string }, params: Record<string, string | boolean>) {
  const query = new URLSearchParams({ start: bounds.start, end: bounds.end });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  return `/transactions?${query.toString()}`;
}

function receiptHref(bounds: { start: string; end: string }, params: Record<string, string | boolean>) {
  const query = new URLSearchParams({ start: bounds.start, end: bounds.end });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  return `/receipts?${query.toString()}`;
}

function exportHref(year: number, month: number, ledgerId: number) {
  const query = new URLSearchParams({
    year: String(year),
    month: String(month),
    ledger_id: String(ledgerId),
  });
  return `/api/export/xlsx?${query.toString()}`;
}

export async function monthlyReviewRoutes(app: FastifyInstance) {
  app.get<{ Querystring: MonthlyReviewQuery }>(
    "/api/review/monthly",
    { schema: { querystring: monthlyReviewQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const { year, month } = selectedMonth(request.query);
      const bounds = currentMonthBounds(year, month);
      const { elapsedDays, daysInMonth } = monthProgress(year, month);

      const [overviewRows, duplicateRows, statementRows, sampleRows, budgets] = await Promise.all([
        sql<Array<{
          transaction_count: string;
          total_cents: string;
          uncategorized_count: string;
          uncategorized_cents: string;
          needs_review_count: string;
          receipts_needs_review_count: string;
          missing_receipt_count: string;
        }>>`
          SELECT
            COUNT(*)::text AS transaction_count,
            COALESCE(SUM(e.amount_cents), 0)::text AS total_cents,
            COUNT(*) FILTER (WHERE e.category_id IS NULL)::text AS uncategorized_count,
            COALESCE(SUM(e.amount_cents) FILTER (WHERE e.category_id IS NULL), 0)::text AS uncategorized_cents,
            COUNT(*) FILTER (WHERE e.review_status = 'needs_review')::text AS needs_review_count,
            COUNT(*) FILTER (WHERE e.image_key IS NOT NULL AND e.review_status = 'needs_review')::text AS receipts_needs_review_count,
            COUNT(*) FILTER (WHERE e.image_key IS NULL)::text AS missing_receipt_count
          FROM expenses e
          WHERE e.user_id = ${session.userId}
            AND e.occurred_at >= ${bounds.start}::date
            AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        `,
        sql<Array<{ duplicate_count: string }>>`
          SELECT COUNT(*)::text AS duplicate_count
          FROM expenses e
          WHERE e.user_id = ${session.userId}
            AND e.occurred_at >= ${bounds.start}::date
            AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
            AND EXISTS (
              SELECT 1
              FROM expenses d
              WHERE d.user_id = e.user_id
                AND d.id <> e.id
                AND d.amount_cents = e.amount_cents
                AND ABS(EXTRACT(EPOCH FROM (d.occurred_at - e.occurred_at))) <= 172800
                AND lower(COALESCE(d.merchant, d.description, '')) =
                    lower(COALESCE(e.merchant, e.description, ''))
            )
        `,
        sql<Array<{
          total: string;
          failed: string;
          pending: string;
          parsed: string;
          imported: string;
          parsed_count: string;
          imported_count: string;
          duplicate_count: string;
        }>>`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
            COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
            COUNT(*) FILTER (WHERE status = 'parsed')::text AS parsed,
            COUNT(*) FILTER (WHERE status = 'imported')::text AS imported,
            COALESCE(SUM(parsed_count), 0)::text AS parsed_count,
            COALESCE(SUM(imported_count), 0)::text AS imported_count,
            COALESCE(SUM(duplicate_count), 0)::text AS duplicate_count
          FROM statements
          WHERE user_id = ${session.userId}
            AND created_at >= ${bounds.start}::date
            AND created_at < (${bounds.end}::date + INTERVAL '1 day')
        `,
        sql<Array<{
          id: string;
          amount_cents: string;
          currency: string;
          merchant: string | null;
          description: string | null;
          category: string | null;
          review_status: string;
          occurred_at: Date;
        }>>`
          SELECT e.id,
                 e.amount_cents::text,
                 e.currency,
                 e.merchant,
                 e.description,
                 COALESCE(c.name, 'Uncategorized') AS category,
                 e.review_status,
                 e.occurred_at
          FROM expenses e
          LEFT JOIN categories c ON c.id = e.category_id
          WHERE e.user_id = ${session.userId}
            AND e.occurred_at >= ${bounds.start}::date
            AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
            AND (e.category_id IS NULL OR e.review_status = 'needs_review')
          ORDER BY
            CASE WHEN e.category_id IS NULL THEN 0 ELSE 1 END,
            e.occurred_at DESC
          LIMIT 5
        `,
        getBudgetsWithMtd(session.userId, bounds.rangeKey),
      ]);

      const overview = overviewRows[0] ?? {
        transaction_count: "0",
        total_cents: "0",
        uncategorized_count: "0",
        uncategorized_cents: "0",
        needs_review_count: "0",
        receipts_needs_review_count: "0",
        missing_receipt_count: "0",
      };
      const statements = statementRows[0] ?? {
        total: "0",
        failed: "0",
        pending: "0",
        parsed: "0",
        imported: "0",
        parsed_count: "0",
        imported_count: "0",
        duplicate_count: "0",
      };
      const duplicateCount = Number(duplicateRows[0]?.duplicate_count ?? 0);
      const budgetVariance = budgets.map((budget) => {
        const daily = elapsedDays > 0 ? budget.spent_cents / elapsedDays : 0;
        const projected_cents = Math.round(daily * daysInMonth);
        return {
          ...budget,
          projected_cents,
          variance_cents: budget.spent_cents - budget.target_cents,
          projected_variance_cents: projected_cents - budget.target_cents,
        };
      });
      const overBudget = budgetVariance.filter((budget) => budget.projected_variance_cents > 0);
      const statementAttention = Number(statements.failed) + Number(statements.pending) + Number(statements.parsed);

      const tasks: ReviewTask[] = [
        {
          id: "uncategorized",
          label: "Categorize transactions",
          detail: "Assign categories before trusting totals and budgets.",
          count: Number(overview.uncategorized_count),
          amount_cents: overview.uncategorized_cents,
          status: Number(overview.uncategorized_count) > 0 ? "attention" : "done",
          href: txHref(bounds, { uncategorized: true }),
        },
        {
          id: "receipts",
          label: "Review receipt OCR",
          detail: "Approve or correct receipt captures with raw OCR visible.",
          count: Number(overview.receipts_needs_review_count),
          status: Number(overview.receipts_needs_review_count) > 0 ? "attention" : "done",
          href: receiptHref(bounds, { review_status: "needs_review" }),
        },
        {
          id: "duplicates",
          label: "Merge likely duplicates",
          detail: "Clean up duplicate captures from receipts, alerts, and statements.",
          count: duplicateCount,
          status: duplicateCount > 0 ? "attention" : "done",
          href: txHref(bounds, { duplicates: true }),
        },
        {
          id: "statements",
          label: "Resolve statement imports",
          detail: "Retry failures and import parsed statement rows.",
          count: statementAttention,
          status: statementAttention > 0 ? "attention" : "done",
          href: "/manage",
        },
        {
          id: "budgets",
          label: "Inspect budget variance",
          detail: "Check categories projected over target before closing the month.",
          count: overBudget.length,
          status: overBudget.length > 0 ? "attention" : "done",
          href: "/manage",
        },
        {
          id: "export",
          label: "Export monthly workbook",
          detail: "Download the month once cleanup is done.",
          count: Number(overview.transaction_count),
          status: Number(overview.transaction_count) > 0 ? "ready" : "done",
          href: exportHref(year, month, session.userId),
        },
      ];

      const openTasks = tasks.filter((task) => task.status === "attention").length;
      const narrative =
        openTasks === 0
          ? `${bounds.label} is ready to close. Export the workbook or review the summary one last time.`
          : `${bounds.label} has ${openTasks} cleanup area${openTasks === 1 ? "" : "s"} before close.`;

      return {
        period: {
          year,
          month,
          label: bounds.label,
          start: bounds.start,
          end: bounds.end,
          rangeKey: bounds.rangeKey,
          elapsedDays,
          daysInMonth,
        },
        overview: {
          transaction_count: Number(overview.transaction_count),
          total_cents: overview.total_cents,
          uncategorized_count: Number(overview.uncategorized_count),
          uncategorized_cents: overview.uncategorized_cents,
          needs_review_count: Number(overview.needs_review_count),
          receipts_needs_review_count: Number(overview.receipts_needs_review_count),
          missing_receipt_count: Number(overview.missing_receipt_count),
          duplicate_candidate_count: duplicateCount,
          open_task_count: openTasks,
        },
        tasks,
        budgets: budgetVariance,
        statements: {
          total: Number(statements.total),
          failed: Number(statements.failed),
          pending: Number(statements.pending),
          parsed: Number(statements.parsed),
          imported: Number(statements.imported),
          parsed_count: Number(statements.parsed_count),
          imported_count: Number(statements.imported_count),
          duplicate_count: Number(statements.duplicate_count),
        },
        samples: sampleRows,
        narrative,
      };
    },
  );
}
