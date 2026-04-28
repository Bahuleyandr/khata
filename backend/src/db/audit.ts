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

export async function listAuditEvents(userId: number, limit: number): Promise<AuditEventRow[]> {
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
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
