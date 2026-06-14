import { sql } from "./index.js";
import {
  classifyCaptureFailure,
  diagnoseCaptureFailure,
  type CaptureFailureDiagnosis,
  type CaptureFailureKind,
} from "../capture/failure-kind.js";
import type { CaptureConfidence } from "../capture/confidence.js";

export type CaptureSource =
  | "telegram_text"
  | "telegram_photo"
  | "telegram_voice"
  | "telegram_document"
  | "dashboard_manual"
  | "statement_upload";

export type CaptureStatus = "pending" | "processed" | "failed" | "ignored";

export interface CaptureEventInput {
  userId: number;
  actorUserId?: number;
  source: CaptureSource;
  rawText?: string | null;
  fileKey?: string | null;
  contentHash?: string | null;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
  confidence?: CaptureConfidence;
}

export interface CaptureEventRow {
  id: string;
  user_id: number;
  actor_user_id: string | null;
  source: CaptureSource;
  raw_text: string | null;
  file_key: string | null;
  content_hash: string | null;
  mime_type: string | null;
  status: CaptureStatus;
  parsed_expense_id: string | null;
  parsed_expense_label: string | null;
  error_reason: string | null;
  failure_kind: CaptureFailureKind | null;
  diagnosis: CaptureFailureDiagnosis;
  metadata: Record<string, unknown>;
  confidence: CaptureConfidence;
  replay_count: number;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
  last_replayed_at: Date | null;
}

export interface CaptureFilters {
  status?: CaptureStatus;
  source?: CaptureSource;
  failureKind?: CaptureFailureKind;
  q?: string;
  limit?: number;
  actorUserId?: number;
}

export interface CaptureFailureSummaryRow {
  failure_kind: CaptureFailureKind;
  count: number;
  latest_error: string | null;
  latest_at: Date;
}

export interface CaptureCountRow {
  key: string;
  count: number;
}

function isDiagnosis(value: unknown): value is CaptureFailureDiagnosis {
  return !!value &&
    typeof value === "object" &&
    typeof (value as { title?: unknown }).title === "string" &&
    typeof (value as { detail?: unknown }).detail === "string" &&
    typeof (value as { next_action?: unknown }).next_action === "string" &&
    typeof (value as { replayable?: unknown }).replayable === "boolean";
}

function normalizeCaptureRow(row: CaptureEventRow): CaptureEventRow {
  const kind = row.failure_kind ?? "unknown";
  const diagnosis = isDiagnosis(row.diagnosis)
    ? row.diagnosis
    : diagnoseCaptureFailure(kind, row.error_reason);
  return {
    ...row,
    diagnosis,
    replay_count: Number(row.replay_count ?? 0),
  };
}

export async function recordCaptureEvent(input: CaptureEventInput): Promise<string> {
  // Pass both metadata and confidence as plain objects so postgres.js serialises once (no ::jsonb cast = no double-encoding).
  const metadata = JSON.parse(JSON.stringify(input.metadata ?? {}));
  const confidence = JSON.parse(JSON.stringify(input.confidence ?? {}));
  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO capture_events (
      user_id,
      actor_user_id,
      source,
      raw_text,
      file_key,
      content_hash,
      mime_type,
      metadata,
      confidence
    )
    VALUES (
      ${input.userId},
      ${input.actorUserId ?? input.userId},
      ${input.source},
      ${input.rawText ?? null},
      ${input.fileKey ?? null},
      ${input.contentHash ?? null},
      ${input.mimeType ?? null},
      ${metadata},
      ${confidence}
    )
    RETURNING id
  `;
  if (!row) throw new Error("Failed to record capture event");
  return row.id;
}

export async function markCaptureProcessed(
  userId: number,
  captureEventId: string | null | undefined,
  expenseId: string | null,
  confidence?: CaptureConfidence,
): Promise<void> {
  if (!captureEventId) return;
  // Pass confidence as a plain object so postgres.js serializes once (no double-encoding).
  const confidenceObj = confidence ? JSON.parse(JSON.stringify(confidence)) : null;
  await sql`
    UPDATE capture_events
    SET status = 'processed',
        parsed_expense_id = ${expenseId},
        error_reason = NULL,
        failure_kind = NULL,
        diagnosis = '{}'::jsonb,
        confidence = CASE WHEN ${confidenceObj !== null} THEN ${confidenceObj} ELSE confidence END,
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${captureEventId}
      AND user_id = ${userId}
  `;
}

export async function updateCaptureRawText(
  userId: number,
  captureEventId: string | null | undefined,
  rawText: string,
): Promise<void> {
  if (!captureEventId) return;
  await sql`
    UPDATE capture_events
    SET raw_text = ${rawText},
        updated_at = NOW()
    WHERE id = ${captureEventId}
      AND user_id = ${userId}
  `;
}

export async function markCaptureFailed(
  userId: number,
  captureEventId: string | null | undefined,
  errorReason: string,
): Promise<void> {
  if (!captureEventId) return;
  const failureKind = classifyCaptureFailure(errorReason);
  // Pass diagnosis as a plain object so postgres.js serialises once (no ::jsonb cast = no double-encoding).
  const diagnosis = JSON.parse(JSON.stringify(diagnoseCaptureFailure(failureKind, errorReason)));
  await sql`
    UPDATE capture_events
    SET status = 'failed',
        error_reason = ${errorReason.slice(0, 500)},
        failure_kind = ${failureKind},
        diagnosis = ${diagnosis},
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${captureEventId}
      AND user_id = ${userId}
  `;
}

export async function markCaptureReplayStarted(
  userId: number,
  captureEventId: string,
): Promise<void> {
  await sql`
    UPDATE capture_events
    SET replay_count = replay_count + 1,
        last_replayed_at = NOW(),
        status = CASE WHEN status = 'ignored' THEN status ELSE 'pending' END,
        updated_at = NOW()
    WHERE id = ${captureEventId}
      AND user_id = ${userId}
      AND status IN ('pending', 'failed', 'ignored')
  `;
}

export async function markCaptureIgnored(
  userId: number,
  captureEventId: string,
): Promise<CaptureEventRow | null> {
  const [row] = await sql<CaptureEventRow[]>`
    UPDATE capture_events
    SET status = 'ignored',
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${captureEventId}
      AND user_id = ${userId}
      AND status IN ('pending', 'failed')
    RETURNING id,
              user_id::bigint::int AS user_id,
              actor_user_id::text AS actor_user_id,
              source,
              raw_text,
              file_key,
              content_hash,
              mime_type,
              status,
              parsed_expense_id::text AS parsed_expense_id,
              NULL::text AS parsed_expense_label,
              error_reason,
              failure_kind,
              diagnosis,
              metadata,
              confidence,
              replay_count,
              created_at,
              updated_at,
              processed_at,
              last_replayed_at
  `;
  return row ? normalizeCaptureRow(row) : null;
}

export async function listCaptureEvents(
  userId: number,
  filters: CaptureFilters = {},
): Promise<CaptureEventRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const status = filters.status ?? null;
  const source = filters.source ?? null;
  const failureKind = filters.failureKind ?? null;
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const actorUserId = filters.actorUserId ?? null;

  const rows = await sql<CaptureEventRow[]>`
    SELECT ce.id,
           ce.user_id::bigint::int AS user_id,
           ce.actor_user_id::text AS actor_user_id,
           ce.source,
           ce.raw_text,
           ce.file_key,
           ce.content_hash,
           ce.mime_type,
           ce.status,
           ce.parsed_expense_id::text AS parsed_expense_id,
           COALESCE(e.merchant, e.description) AS parsed_expense_label,
           ce.error_reason,
           ce.failure_kind,
           ce.diagnosis,
           ce.metadata,
           ce.confidence,
           ce.replay_count,
           ce.created_at,
           ce.updated_at,
           ce.processed_at,
           ce.last_replayed_at
    FROM capture_events ce
    LEFT JOIN expenses e
      ON e.id = ce.parsed_expense_id
     AND e.user_id = ce.user_id
    WHERE ce.user_id = ${userId}
      AND (${status}::text IS NULL OR ce.status = ${status})
      AND (${source}::text IS NULL OR ce.source = ${source})
      AND (${failureKind}::text IS NULL OR ce.failure_kind = ${failureKind})
      AND (
        ${q}::text IS NULL
        OR ce.raw_text ILIKE ${q}
        OR ce.error_reason ILIKE ${q}
        OR COALESCE(e.merchant, e.description) ILIKE ${q}
      )
      AND (${actorUserId}::bigint IS NULL OR ce.actor_user_id = ${actorUserId}::bigint)
    ORDER BY ce.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(normalizeCaptureRow);
}

export async function getCaptureEvent(
  userId: number,
  captureEventId: string,
): Promise<CaptureEventRow | null> {
  const [row] = await sql<CaptureEventRow[]>`
    SELECT ce.id,
           ce.user_id::bigint::int AS user_id,
           ce.actor_user_id::text AS actor_user_id,
           ce.source,
           ce.raw_text,
           ce.file_key,
           ce.content_hash,
           ce.mime_type,
           ce.status,
           ce.parsed_expense_id::text AS parsed_expense_id,
           COALESCE(e.merchant, e.description) AS parsed_expense_label,
           ce.error_reason,
           ce.failure_kind,
           ce.diagnosis,
           ce.metadata,
           ce.confidence,
           ce.replay_count,
           ce.created_at,
           ce.updated_at,
           ce.processed_at,
           ce.last_replayed_at
    FROM capture_events ce
    LEFT JOIN expenses e
      ON e.id = ce.parsed_expense_id
     AND e.user_id = ce.user_id
    WHERE ce.id = ${captureEventId}
      AND ce.user_id = ${userId}
    LIMIT 1
  `;
  return row ? normalizeCaptureRow(row) : null;
}

export async function summarizeCaptureFailures(userId: number, actorUserId?: number): Promise<CaptureFailureSummaryRow[]> {
  const actor = actorUserId ?? null;
  return sql<CaptureFailureSummaryRow[]>`
    WITH failed AS (
      SELECT COALESCE(failure_kind, 'unknown') AS failure_kind,
             error_reason,
             created_at,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(failure_kind, 'unknown')
               ORDER BY created_at DESC
             ) AS rn
      FROM capture_events
      WHERE user_id = ${userId}
        AND status = 'failed'
        AND created_at >= NOW() - INTERVAL '90 days'
        AND (${actor}::bigint IS NULL OR actor_user_id = ${actor}::bigint)
    ),
    grouped AS (
      SELECT failure_kind,
             COUNT(*)::int AS count,
             MAX(created_at) AS latest_at
      FROM failed
      GROUP BY failure_kind
    )
    SELECT grouped.failure_kind,
           grouped.count,
           failed.error_reason AS latest_error,
           grouped.latest_at
    FROM grouped
    LEFT JOIN failed
      ON failed.failure_kind = grouped.failure_kind
     AND failed.rn = 1
    ORDER BY grouped.count DESC, grouped.latest_at DESC
  `;
}

export async function summarizeCaptureStatuses(userId: number, actorUserId?: number): Promise<CaptureCountRow[]> {
  const actor = actorUserId ?? null;
  return sql<CaptureCountRow[]>`
    SELECT status AS key,
           COUNT(*)::int AS count
    FROM capture_events
    WHERE user_id = ${userId}
      AND created_at >= NOW() - INTERVAL '90 days'
      AND (${actor}::bigint IS NULL OR actor_user_id = ${actor}::bigint)
    GROUP BY status
    ORDER BY count DESC, status ASC
  `;
}

export async function summarizeCaptureSources(userId: number, actorUserId?: number): Promise<CaptureCountRow[]> {
  const actor = actorUserId ?? null;
  return sql<CaptureCountRow[]>`
    SELECT source AS key,
           COUNT(*)::int AS count
    FROM capture_events
    WHERE user_id = ${userId}
      AND created_at >= NOW() - INTERVAL '90 days'
      AND (${actor}::bigint IS NULL OR actor_user_id = ${actor}::bigint)
    GROUP BY source
    ORDER BY count DESC, source ASC
  `;
}
