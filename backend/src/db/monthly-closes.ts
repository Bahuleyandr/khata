import { sql } from "./index.js";

export type MonthlyCloseStatus = "open" | "ready" | "closed" | "reopened";

export interface MonthlyCloseRow {
  id: string;
  user_id: string;
  period_month: Date;
  status: MonthlyCloseStatus;
  readiness_score: number;
  open_task_count: number;
  total_cents: string;
  transaction_count: number;
  exported_at: Date | null;
  closed_at: Date | null;
  reopened_at: Date | null;
  actor_user_id: string | null;
  close_note: string | null;
  snapshot: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface MonthlyCloseSnapshotInput {
  userId: number;
  actorUserId: number;
  periodMonth: string;
  readinessScore: number;
  openTaskCount: number;
  totalCents: number;
  transactionCount: number;
  snapshot: Record<string, unknown>;
}

export function periodMonthDate(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function derivedStatus(openTaskCount: number): MonthlyCloseStatus {
  return openTaskCount === 0 ? "ready" : "open";
}

export async function getMonthlyClose(userId: number, periodMonth: string): Promise<MonthlyCloseRow | null> {
  const [row] = await sql<MonthlyCloseRow[]>`
    SELECT id,
           user_id::text AS user_id,
           period_month,
           status,
           readiness_score,
           open_task_count,
           total_cents::text AS total_cents,
           transaction_count,
           exported_at,
           closed_at,
           reopened_at,
           actor_user_id::text AS actor_user_id,
           close_note,
           snapshot,
           created_at,
           updated_at
    FROM monthly_closes
    WHERE user_id = ${userId}
      AND period_month = ${periodMonth}::date
    LIMIT 1
  `;
  return row ?? null;
}

export async function markMonthlyCloseExported(input: MonthlyCloseSnapshotInput): Promise<MonthlyCloseRow> {
  const snapshotJson = JSON.stringify(input.snapshot);
  const status = derivedStatus(input.openTaskCount);
  const [row] = await sql<MonthlyCloseRow[]>`
    INSERT INTO monthly_closes (
      user_id,
      period_month,
      status,
      readiness_score,
      open_task_count,
      total_cents,
      transaction_count,
      exported_at,
      actor_user_id,
      snapshot
    )
    VALUES (
      ${input.userId},
      ${input.periodMonth}::date,
      ${status},
      ${input.readinessScore},
      ${input.openTaskCount},
      ${input.totalCents},
      ${input.transactionCount},
      NOW(),
      ${input.actorUserId},
      ${snapshotJson}::jsonb
    )
    ON CONFLICT (user_id, period_month)
    DO UPDATE SET
      status = CASE
        WHEN monthly_closes.status = 'closed' THEN monthly_closes.status
        ELSE EXCLUDED.status
      END,
      readiness_score = EXCLUDED.readiness_score,
      open_task_count = EXCLUDED.open_task_count,
      total_cents = EXCLUDED.total_cents,
      transaction_count = EXCLUDED.transaction_count,
      exported_at = NOW(),
      actor_user_id = EXCLUDED.actor_user_id,
      snapshot = EXCLUDED.snapshot,
      updated_at = NOW()
    RETURNING id,
              user_id::text AS user_id,
              period_month,
              status,
              readiness_score,
              open_task_count,
              total_cents::text AS total_cents,
              transaction_count,
              exported_at,
              closed_at,
              reopened_at,
              actor_user_id::text AS actor_user_id,
              close_note,
              snapshot,
              created_at,
              updated_at
  `;
  if (!row) throw new Error("Failed to mark monthly review as exported");
  return row;
}

export async function closeMonthlyPeriod(
  input: MonthlyCloseSnapshotInput & { note?: string | null },
): Promise<MonthlyCloseRow> {
  const snapshotJson = JSON.stringify(input.snapshot);
  const note = input.note?.trim() || null;
  const [row] = await sql<MonthlyCloseRow[]>`
    INSERT INTO monthly_closes (
      user_id,
      period_month,
      status,
      readiness_score,
      open_task_count,
      total_cents,
      transaction_count,
      closed_at,
      actor_user_id,
      close_note,
      snapshot
    )
    VALUES (
      ${input.userId},
      ${input.periodMonth}::date,
      'closed',
      ${input.readinessScore},
      ${input.openTaskCount},
      ${input.totalCents},
      ${input.transactionCount},
      NOW(),
      ${input.actorUserId},
      ${note},
      ${snapshotJson}::jsonb
    )
    ON CONFLICT (user_id, period_month)
    DO UPDATE SET
      status = 'closed',
      readiness_score = EXCLUDED.readiness_score,
      open_task_count = EXCLUDED.open_task_count,
      total_cents = EXCLUDED.total_cents,
      transaction_count = EXCLUDED.transaction_count,
      closed_at = NOW(),
      actor_user_id = EXCLUDED.actor_user_id,
      close_note = EXCLUDED.close_note,
      snapshot = EXCLUDED.snapshot,
      updated_at = NOW()
    RETURNING id,
              user_id::text AS user_id,
              period_month,
              status,
              readiness_score,
              open_task_count,
              total_cents::text AS total_cents,
              transaction_count,
              exported_at,
              closed_at,
              reopened_at,
              actor_user_id::text AS actor_user_id,
              close_note,
              snapshot,
              created_at,
              updated_at
  `;
  if (!row) throw new Error("Failed to close monthly review");
  return row;
}

export async function reopenMonthlyPeriod(
  userId: number,
  actorUserId: number,
  periodMonth: string,
  note?: string | null,
): Promise<MonthlyCloseRow | null> {
  const closeNote = note?.trim() || null;
  const [row] = await sql<MonthlyCloseRow[]>`
    UPDATE monthly_closes
    SET status = 'reopened',
        reopened_at = NOW(),
        actor_user_id = ${actorUserId},
        close_note = COALESCE(${closeNote}, close_note),
        updated_at = NOW()
    WHERE user_id = ${userId}
      AND period_month = ${periodMonth}::date
    RETURNING id,
              user_id::text AS user_id,
              period_month,
              status,
              readiness_score,
              open_task_count,
              total_cents::text AS total_cents,
              transaction_count,
              exported_at,
              closed_at,
              reopened_at,
              actor_user_id::text AS actor_user_id,
              close_note,
              snapshot,
              created_at,
              updated_at
  `;
  return row ?? null;
}
