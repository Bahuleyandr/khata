import { sql } from "./index.js";
import { classifyCaptureFailure, type CaptureFailureKind } from "../capture/failure-kind.js";
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
  metadata: Record<string, unknown>;
  confidence: CaptureConfidence;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
}

export interface CaptureFilters {
  status?: CaptureStatus;
  source?: CaptureSource;
  limit?: number;
}

export interface CaptureFailureSummaryRow {
  failure_kind: CaptureFailureKind;
  count: number;
  latest_error: string | null;
  latest_at: Date;
}

export async function recordCaptureEvent(input: CaptureEventInput): Promise<string> {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const confidenceJson = JSON.stringify(input.confidence ?? {});
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
      ${metadataJson}::jsonb,
      ${confidenceJson}::jsonb
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
  const confidenceJson = confidence ? JSON.stringify(confidence) : null;
  await sql`
    UPDATE capture_events
    SET status = 'processed',
        parsed_expense_id = ${expenseId},
        error_reason = NULL,
        failure_kind = NULL,
        confidence = CASE WHEN ${confidenceJson !== null} THEN ${confidenceJson ?? "{}"}::jsonb ELSE confidence END,
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
  await sql`
    UPDATE capture_events
    SET status = 'failed',
        error_reason = ${errorReason.slice(0, 500)},
        failure_kind = ${failureKind},
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${captureEventId}
      AND user_id = ${userId}
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
              metadata,
              confidence,
              created_at,
              updated_at,
              processed_at
  `;
  return row ?? null;
}

export async function listCaptureEvents(
  userId: number,
  filters: CaptureFilters = {},
): Promise<CaptureEventRow[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const status = filters.status ?? null;
  const source = filters.source ?? null;

  return sql<CaptureEventRow[]>`
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
           ce.metadata,
           ce.confidence,
           ce.created_at,
           ce.updated_at,
           ce.processed_at
    FROM capture_events ce
    LEFT JOIN expenses e
      ON e.id = ce.parsed_expense_id
     AND e.user_id = ce.user_id
    WHERE ce.user_id = ${userId}
      AND (${status}::text IS NULL OR ce.status = ${status})
      AND (${source}::text IS NULL OR ce.source = ${source})
    ORDER BY ce.created_at DESC
    LIMIT ${limit}
  `;
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
           ce.metadata,
           ce.confidence,
           ce.created_at,
           ce.updated_at,
           ce.processed_at
    FROM capture_events ce
    LEFT JOIN expenses e
      ON e.id = ce.parsed_expense_id
     AND e.user_id = ce.user_id
    WHERE ce.id = ${captureEventId}
      AND ce.user_id = ${userId}
    LIMIT 1
  `;
  return row ?? null;
}

export async function summarizeCaptureFailures(userId: number): Promise<CaptureFailureSummaryRow[]> {
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
