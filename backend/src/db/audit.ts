import { sql } from "./index.js";

export interface AuditEventInput {
  userId: number;
  actorUserId?: number;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditEventRow {
  id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface AuditEventFilters {
  limit: number;
  action?: string;
  entityType?: string;
  entityId?: string;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const beforeJson = JSON.stringify(input.before ?? null);
  const afterJson = JSON.stringify(input.after ?? null);
  const metadataJson = JSON.stringify(input.metadata ?? {});

  await sql`
    INSERT INTO audit_log (
      user_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before,
      after,
      metadata
    )
    VALUES (
      ${input.userId},
      ${input.actorUserId ?? input.userId},
      ${input.action},
      ${input.entityType},
      ${input.entityId ?? null},
      ${beforeJson}::jsonb,
      ${afterJson}::jsonb,
      ${metadataJson}::jsonb
    )
  `;
}

export async function listAuditEvents(
  userId: number,
  filtersOrLimit: AuditEventFilters | number,
): Promise<AuditEventRow[]> {
  const filters =
    typeof filtersOrLimit === "number"
      ? { limit: filtersOrLimit }
      : filtersOrLimit;
  const action = filters.action ?? null;
  const entityType = filters.entityType ?? null;
  const entityId = filters.entityId ?? null;

  return sql<AuditEventRow[]>`
    SELECT id,
           actor_user_id::text AS actor_user_id,
           action,
           entity_type,
           entity_id::text AS entity_id,
           before,
           after,
           metadata,
           created_at
    FROM audit_log
    WHERE user_id = ${userId}
      AND (${action}::text IS NULL OR action = ${action})
      AND (${entityType}::text IS NULL OR entity_type = ${entityType})
      AND (${entityId}::uuid IS NULL OR entity_id = ${entityId}::uuid)
    ORDER BY created_at DESC
    LIMIT ${filters.limit}
  `;
}
