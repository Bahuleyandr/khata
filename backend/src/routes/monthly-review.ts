import type { FastifyInstance, FastifyReply } from "fastify";
import { recordAuditEvent } from "../db/audit.js";
import { getBudgetsWithMtd } from "../db/budgets.js";
import { sql } from "../db/index.js";
import {
  closeMonthlyPeriod,
  getMonthlyClose,
  markMonthlyCloseExported,
  periodMonthDate,
  reopenMonthlyPeriod,
  type MonthlyCloseRow,
  type MonthlyCloseStatus,
} from "../db/monthly-closes.js";
import { currentMonthBounds } from "../export/xlsx.js";
import { getSession, type AuthenticatedSession } from "./auth.js";

type MonthlyReviewQuery = {
  year?: number;
  month?: number;
};

type MonthCloseActionBody = {
  year: number;
  month: number;
  note?: string;
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

type MonthlyCloseView = {
  status: MonthlyCloseStatus;
  readiness_score: number;
  can_close: boolean;
  blockers: Array<Pick<ReviewTask, "id" | "label" | "count" | "href">>;
  exported_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  close_note: string | null;
};

type MonthlyReviewPayload = {
  period: {
    year: number;
    month: number;
    label: string;
    start: string;
    end: string;
    rangeKey: string;
    elapsedDays: number;
    daysInMonth: number;
  };
  overview: {
    transaction_count: number;
    total_cents: string;
    uncategorized_count: number;
    uncategorized_cents: string;
    needs_review_count: number;
    receipts_needs_review_count: number;
    missing_receipt_count: number;
    duplicate_candidate_count: number;
    open_task_count: number;
  };
  tasks: ReviewTask[];
  budgets: Array<Record<string, unknown>>;
  statements: {
    total: number;
    failed: number;
    pending: number;
    parsed: number;
    imported: number;
    parsed_count: number;
    imported_count: number;
    duplicate_count: number;
  };
  samples: Array<Record<string, unknown>>;
  narrative: string;
  close: MonthlyCloseView;
};

const monthlyReviewQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
  },
} as const;

const monthCloseActionBodySchema = {
  type: "object",
  required: ["year", "month"],
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
    note: { type: "string", maxLength: 500 },
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

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function closeView(
  row: MonthlyCloseRow | null,
  tasks: ReviewTask[],
  readinessScore: number,
  openTaskCount: number,
): MonthlyCloseView {
  const status = row?.status ?? (openTaskCount === 0 ? "ready" : "open");
  return {
    status,
    readiness_score: readinessScore,
    can_close: status !== "closed" && openTaskCount === 0,
    blockers: tasks
      .filter((task) => task.status === "attention")
      .map((task) => ({
        id: task.id,
        label: task.label,
        count: task.count,
        href: task.href,
      })),
    exported_at: isoDate(row?.exported_at),
    closed_at: isoDate(row?.closed_at),
    reopened_at: isoDate(row?.reopened_at),
    close_note: row?.close_note ?? null,
  };
}

function snapshotForClose(review: MonthlyReviewPayload): Record<string, unknown> {
  return {
    period: review.period,
    overview: review.overview,
    tasks: review.tasks,
    budgets: review.budgets,
    statements: review.statements,
    narrative: review.narrative,
  };
}

function monthlyCloseInput(
  session: AuthenticatedSession,
  review: MonthlyReviewPayload,
): {
  userId: number;
  actorUserId: number;
  periodMonth: string;
  readinessScore: number;
  openTaskCount: number;
  totalCents: number;
  transactionCount: number;
  snapshot: Record<string, unknown>;
} {
  return {
    userId: session.userId,
    actorUserId: session.actorUserId,
    periodMonth: periodMonthDate(review.period.year, review.period.month),
    readinessScore: review.close.readiness_score,
    openTaskCount: review.overview.open_task_count,
    totalCents: Number(review.overview.total_cents),
    transactionCount: review.overview.transaction_count,
    snapshot: snapshotForClose(review),
  };
}

function requireManager(session: AuthenticatedSession, reply: FastifyReply): boolean {
  if (session.canManage) return true;
  reply.status(403).send({ error: "Only ledger owners can close monthly reviews" });
  return false;
}

async function buildMonthlyReview(
  session: AuthenticatedSession,
  year: number,
  month: number,
): Promise<MonthlyReviewPayload> {
  const bounds = currentMonthBounds(year, month);
  const { elapsedDays, daysInMonth } = monthProgress(year, month);
  const periodMonth = periodMonthDate(year, month);

  const [overviewRows, duplicateRows, statementRows, sampleRows, budgets, closeRow] = await Promise.all([
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
    getMonthlyClose(session.userId, periodMonth),
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
  const readinessScore = tasks.length > 0 ? Math.round(((tasks.length - openTasks) / tasks.length) * 100) : 100;
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
    close: closeView(closeRow, tasks, readinessScore, openTasks),
  };
}

export async function monthlyReviewRoutes(app: FastifyInstance) {
  app.get<{ Querystring: MonthlyReviewQuery }>(
    "/api/review/monthly",
    { schema: { querystring: monthlyReviewQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const { year, month } = selectedMonth(request.query);
      return buildMonthlyReview(session, year, month);
    },
  );

  app.post<{ Body: MonthCloseActionBody }>(
    "/api/review/monthly/exported",
    { schema: { body: monthCloseActionBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session || !requireManager(session, reply)) return;

      const review = await buildMonthlyReview(session, request.body.year, request.body.month);
      const before = review.close;
      const row = await markMonthlyCloseExported(monthlyCloseInput(session, review));
      const after = closeView(row, review.tasks, review.close.readiness_score, review.overview.open_task_count);

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "month_close.exported",
        entityType: "month_close",
        entityId: row.id,
        before,
        after,
        metadata: { period: review.period.rangeKey },
      });

      return { ok: true, close: after };
    },
  );

  app.post<{ Body: MonthCloseActionBody }>(
    "/api/review/monthly/close",
    { schema: { body: monthCloseActionBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session || !requireManager(session, reply)) return;

      const review = await buildMonthlyReview(session, request.body.year, request.body.month);
      if (!review.close.can_close) {
        return reply.status(409).send({
          error: "Resolve monthly review blockers before closing",
          close: review.close,
        });
      }

      const before = review.close;
      const row = await closeMonthlyPeriod({
        ...monthlyCloseInput(session, review),
        note: request.body.note,
      });
      const after = closeView(row, review.tasks, review.close.readiness_score, review.overview.open_task_count);

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "month_close.close",
        entityType: "month_close",
        entityId: row.id,
        before,
        after,
        metadata: { period: review.period.rangeKey },
      });

      return { ok: true, close: after };
    },
  );

  app.post<{ Body: MonthCloseActionBody }>(
    "/api/review/monthly/reopen",
    { schema: { body: monthCloseActionBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session || !requireManager(session, reply)) return;

      const review = await buildMonthlyReview(session, request.body.year, request.body.month);
      const before = review.close;
      const row = await reopenMonthlyPeriod(
        session.userId,
        session.actorUserId,
        periodMonthDate(request.body.year, request.body.month),
        request.body.note,
      );
      if (!row) return reply.status(404).send({ error: "Monthly close record not found" });

      const after = closeView(row, review.tasks, review.close.readiness_score, review.overview.open_task_count);
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "month_close.reopen",
        entityType: "month_close",
        entityId: row.id,
        before,
        after,
        metadata: { period: review.period.rangeKey },
      });

      return { ok: true, close: after };
    },
  );
}
