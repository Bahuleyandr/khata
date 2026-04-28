import { sql } from "../db/index.js";
import type { DedupeResult } from "./types.js";

export async function bulkInsertTransactions(
  userId: number,
  statementId: string,
  results: DedupeResult[],
): Promise<number> {
  const newTxs = results.filter((r) => !r.alreadyLogged).map((r) => r.transaction);
  if (newTxs.length === 0) return 0;

  await sql`
    INSERT INTO expenses
      (user_id, amount_cents, currency, description, occurred_at, source, statement_id, review_status)
    SELECT
      v.user_id,
      v.amount_cents,
      v.currency,
      v.description,
      v.occurred_at,
      'statement',
      v.statement_id,
      'needs_review'
    FROM jsonb_to_recordset(${JSON.stringify(
      newTxs.map((tx) => ({
        user_id: userId,
        amount_cents: tx.amountCents,
        currency: tx.currency,
        description: tx.description,
        occurred_at: tx.date,
        statement_id: statementId,
      })),
    )}::jsonb) AS v(
      user_id BIGINT,
      amount_cents BIGINT,
      currency TEXT,
      description TEXT,
      occurred_at TIMESTAMPTZ,
      statement_id UUID
    )
  `;

  return newTxs.length;
}

export async function updateStatementStatus(
  statementId: string,
  status: "pending" | "parsed" | "imported" | "failed",
  parsedCount?: number,
  errorReason?: string | null,
  importedCount?: number,
  duplicateCount?: number,
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
