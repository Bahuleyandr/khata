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
  undone_at: Date | null;
  undone_by: string | null;
  undo_event_id: string | null;
  undo_error: string | null;
}

export interface AuditEventFilters {
  limit: number;
  action?: string;
  entityType?: string;
  entityId?: string;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  const beforeJson = JSON.stringify(input.before ?? null);
  const afterJson = JSON.stringify(input.after ?? null);
  const metadataJson = JSON.stringify(input.metadata ?? {});

  const rows = await sql<Array<{ id: string }>>`
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
    RETURNING id
  `;
  return rows?.[0]?.id ?? "";
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
           created_at,
           undone_at,
           undone_by::text AS undone_by,
           undo_event_id::text AS undo_event_id,
           undo_error
    FROM audit_log
    WHERE user_id = ${userId}
      AND (${action}::text IS NULL OR action = ${action})
      AND (${entityType}::text IS NULL OR entity_type = ${entityType})
      AND (${entityId}::uuid IS NULL OR entity_id = ${entityId}::uuid)
    ORDER BY created_at DESC
    LIMIT ${filters.limit}
  `;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

export async function undoAuditEvent(
  userId: number,
  actorUserId: number,
  eventId: string,
): Promise<AuditEventRow> {
  return sql.begin(async (tx) => {
    const [event] = await tx<Array<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      before: unknown;
      after: unknown;
      metadata: Record<string, unknown>;
      undone_at: Date | null;
    }>>`
      SELECT id,
             action,
             entity_type,
             entity_id::text AS entity_id,
             before,
             after,
             metadata,
             undone_at
      FROM audit_log
      WHERE id = ${eventId}
        AND user_id = ${userId}
      FOR UPDATE
    `;

    if (!event) throw Object.assign(new Error("Audit event not found"), { statusCode: 404 });
    if (event.undone_at) throw Object.assign(new Error("Audit event already undone"), { statusCode: 409 });

    let undoDetail: Record<string, unknown> = {};

    if (event.action === "expense.create" && isRecord(event.after)) {
      const createdId = getString(event.after.id) ?? event.entity_id;
      if (!createdId) throw Object.assign(new Error("Created expense id is missing"), { statusCode: 422 });
      await tx`
        DELETE FROM expenses
        WHERE id = ${createdId}
          AND user_id = ${userId}
      `;
      undoDetail = { deleted_expense_id: createdId };
    } else if (event.action === "expense.update" && isRecord(event.before)) {
      const before = event.before;
      const expenseId = getString(before.id) ?? event.entity_id;
      const amountCents = getNumber(before.amount_cents);
      const currency = getString(before.currency) ?? "INR";
      const reviewStatus = getString(before.review_status) ?? "reviewed";
      const occurredAt = getString(before.occurred_at);
      if (!expenseId || amountCents === null || !occurredAt) {
        throw Object.assign(new Error("Previous expense state is incomplete"), { statusCode: 422 });
      }
      await tx`
        UPDATE expenses
        SET amount_cents = ${amountCents},
            currency = ${currency},
            description = ${getString(before.description)},
            merchant = ${getString(before.merchant)},
            merchant_canonical_id = ${getString(before.merchant_canonical_id)},
            category_id = ${getString(before.category_id)},
            account_id = ${getString(before.account_id)},
            capture_event_id = ${getString(before.capture_event_id)},
            occurred_at = ${occurredAt},
            image_key = ${getString(before.image_key)},
            review_status = ${reviewStatus},
            reviewed_at = CASE WHEN ${reviewStatus} = 'reviewed' THEN NOW() ELSE NULL END
        WHERE id = ${expenseId}
          AND user_id = ${userId}
      `;
      undoDetail = { restored_expense_id: expenseId };
    } else if (event.action === "expense.delete" && isRecord(event.before)) {
      const before = event.before;
      const expenseId = getString(before.id) ?? event.entity_id;
      const amountCents = getNumber(before.amount_cents);
      const currency = getString(before.currency) ?? "INR";
      const source = getString(before.source) ?? "manual";
      const occurredAt = getString(before.occurred_at);
      const reviewStatus = getString(before.review_status) ?? "reviewed";
      if (!expenseId || amountCents === null || !occurredAt) {
        throw Object.assign(new Error("Deleted expense state is incomplete"), { statusCode: 422 });
      }
      await tx`
        INSERT INTO expenses (
          id,
          user_id,
          amount_cents,
          currency,
          description,
          merchant,
          merchant_canonical_id,
          category_id,
          account_id,
          capture_event_id,
          occurred_at,
          source,
          image_key,
          review_status,
          reviewed_at
        )
        VALUES (
          ${expenseId},
          ${userId},
          ${amountCents},
          ${currency},
          ${getString(before.description)},
          ${getString(before.merchant)},
          ${getString(before.merchant_canonical_id)},
          ${getString(before.category_id)},
          ${getString(before.account_id)},
          ${getString(before.capture_event_id)},
          ${occurredAt},
          ${source},
          ${getString(before.image_key)},
          ${reviewStatus},
          CASE WHEN ${reviewStatus} = 'reviewed' THEN NOW() ELSE NULL END
        )
      `;
      undoDetail = { restored_expense_id: expenseId };
    } else if (event.action === "statement.row_update" && isRecord(event.before)) {
      const before = event.before;
      const rowId = getString(before.id) ?? getString(event.metadata?.row_id);
      const tagNames = Array.isArray(before.tag_names)
        ? before.tag_names.filter((tag): tag is string => typeof tag === "string")
        : [];
      if (!rowId) throw Object.assign(new Error("Statement row id is missing"), { statusCode: 422 });
      await tx`
        UPDATE statement_import_rows
        SET status = ${getString(before.status) ?? "pending"},
            category_id = ${getString(before.category_id)},
            account_id = ${getString(before.account_id)},
            tag_names = ${tagNames}::text[],
            updated_at = NOW()
        WHERE id = ${rowId}
          AND user_id = ${userId}
          AND status IN ('pending', 'ignored')
      `;
      undoDetail = { restored_statement_row_id: rowId };
    } else {
      throw Object.assign(new Error("This audit event cannot be undone safely"), { statusCode: 422 });
    }

    const metadataJson = JSON.stringify({ undone_event_id: event.id, ...undoDetail });
    const [undoEvent] = await tx<Array<{ id: string }>>`
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
        ${userId},
        ${actorUserId},
        'audit.undo',
        ${event.entity_type},
        ${event.entity_id},
        ${JSON.stringify(event)}::jsonb,
        ${JSON.stringify(undoDetail)}::jsonb,
        ${metadataJson}::jsonb
      )
      RETURNING id
    `;

    await tx`
      UPDATE audit_log
      SET undone_at = NOW(),
          undone_by = ${actorUserId},
          undo_event_id = ${undoEvent?.id ?? null},
          undo_error = NULL
      WHERE id = ${event.id}
        AND user_id = ${userId}
    `;

    const [row] = await tx<AuditEventRow[]>`
      SELECT id,
             actor_user_id::text AS actor_user_id,
             action,
             entity_type,
             entity_id::text AS entity_id,
             before,
             after,
             metadata,
             created_at,
             undone_at,
             undone_by::text AS undone_by,
             undo_event_id::text AS undo_event_id,
             undo_error
      FROM audit_log
      WHERE id = ${event.id}
        AND user_id = ${userId}
      LIMIT 1
    `;
    if (!row) throw new Error("Failed to load undone audit event");
    return row;
  });
}
