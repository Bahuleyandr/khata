import { sql } from "../db/index.js";
import type { DedupeResult } from "./types.js";
import { buildCaptureConfidence } from "../capture/confidence.js";

export async function bulkInsertTransactions(
  userId: number,
  statementId: string,
  results: DedupeResult[],
): Promise<number> {
  const newTxs = results.filter((r) => !r.alreadyLogged).map((r) => r.transaction);
  if (newTxs.length === 0) return 0;

  const payload = newTxs.map((tx) => {
    const confidence = buildCaptureConfidence({
      amountCents: tx.amountCents,
      occurredAt: new Date(tx.date),
      merchant: null,
      description: tx.description,
      categoryId: null,
      accountId: null,
      source: "statement",
      parser: "statement",
      rawText: tx.description,
    });
    return {
      user_id: userId,
      amount_cents: tx.amountCents,
      currency: tx.currency,
      description: tx.description,
      occurred_at: tx.date,
      statement_id: statementId,
      confidence,
      paid_by_user_id: userId,
      settlement_scope: userId < 0 ? "shared" : "personal",
    };
  });

  return sql.begin(async (tx) => {
    const [statement] = await tx<Array<{ id: string }>>`
      SELECT id
      FROM statements
      WHERE id = ${statementId}
        AND user_id = ${userId}
      FOR UPDATE
    `;
    if (!statement) {
      throw Object.assign(new Error("Statement does not belong to this ledger"), { statusCode: 403 });
    }

    await tx`
      INSERT INTO expenses
        (user_id, amount_cents, currency, description, occurred_at, source, statement_id,
         review_status, confidence, paid_by_user_id, settlement_scope)
      SELECT
        v.user_id,
        v.amount_cents,
        v.currency,
        v.description,
        v.occurred_at,
        'statement',
        v.statement_id,
        'needs_review',
        v.confidence,
        v.paid_by_user_id,
        v.settlement_scope
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(
        user_id BIGINT,
        amount_cents BIGINT,
        currency TEXT,
        description TEXT,
        occurred_at TIMESTAMPTZ,
        statement_id UUID,
        confidence JSONB,
        paid_by_user_id BIGINT,
        settlement_scope TEXT
      )
    `;

    return newTxs.length;
  });
}

export async function updateStatementStatus(
  statementId: string,
  status: "pending" | "parsed" | "imported" | "failed",
  parsedCount?: number,
  errorReason?: string | null,
  importedCount?: number,
  duplicateCount?: number,
  userId?: number,
): Promise<void> {
  await sql`
    UPDATE statements
    SET status = ${status},
        parsed_count = CASE WHEN ${parsedCount !== undefined} THEN ${parsedCount ?? 0} ELSE parsed_count END,
        error_reason = CASE WHEN ${errorReason !== undefined} THEN ${errorReason ?? null} ELSE error_reason END,
        imported_count = CASE WHEN ${importedCount !== undefined} THEN ${importedCount ?? 0} ELSE imported_count END,
        duplicate_count = CASE WHEN ${duplicateCount !== undefined} THEN ${duplicateCount ?? 0} ELSE duplicate_count END,
        updated_at = NOW()
    WHERE id = ${statementId}
      ${userId === undefined ? sql`` : sql`AND user_id = ${userId}`}
  `;
}

export async function createStatementRecord(
  userId: number,
  fileKey: string,
  mimeType?: string,
): Promise<string> {
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO statements (user_id, file_key, mime_type, status)
    VALUES (${userId}, ${fileKey}, ${mimeType ?? null}, 'pending')
    RETURNING id
  `;
  return row.id;
}
