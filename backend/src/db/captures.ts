import { sql } from "./index.js";

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
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
}

export interface CaptureFilters {
  status?: CaptureStatus;
  source?: CaptureSource;
  limit?: number;
}

export async function recordCaptureEvent(input: CaptureEventInput): Promise<string> {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO capture_events (
      user_id,
      actor_user_id,
      source,
      raw_text,
      file_key,
      content_hash,
      mime_type,
      metadata
    )
    VALUES (
      ${input.userId},
      ${input.actorUserId ?? input.userId},
      ${input.source},
      ${input.rawText ?? null},
      ${input.fileKey ?? null},
      ${input.contentHash ?? null},
      ${input.mimeType ?? null},
      ${metadataJson}::jsonb
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
): Promise<void> {
  if (!captureEventId) return;
  await sql`
    UPDATE capture_events
    SET status = 'processed',
        parsed_expense_id = ${expenseId},
        error_reason = NULL,
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
  await sql`
    UPDATE capture_events
    SET status = 'failed',
        error_reason = ${errorReason.slice(0, 500)},
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
              metadata,
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
           ce.metadata,
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
           ce.metadata,
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
