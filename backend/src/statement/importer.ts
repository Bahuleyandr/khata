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
      (user_id, amount_cents, currency, description, occurred_at, source, statement_id)
    SELECT
      v.user_id,
      v.amount_cents,
      v.currency,
      v.description,
      v.occurred_at,
      'statement',
      v.statement_id
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
  errorReason?: string,
): Promise<void> {
  if (parsedCount !== undefined && errorReason !== undefined) {
    await sql`
      UPDATE statements
      SET status = ${status}, parsed_count = ${parsedCount}, error_reason = ${errorReason}
      WHERE id = ${statementId}
    `;
  } else if (parsedCount !== undefined) {
    await sql`
      UPDATE statements
      SET status = ${status}, parsed_count = ${parsedCount}
      WHERE id = ${statementId}
    `;
  } else if (errorReason !== undefined) {
    await sql`
      UPDATE statements
      SET status = ${status}, error_reason = ${errorReason}
      WHERE id = ${statementId}
    `;
  } else {
    await sql`
      UPDATE statements SET status = ${status} WHERE id = ${statementId}
    `;
  }
}

export async function createStatementRecord(
  userId: number,
  fileKey: string,
): Promise<string> {
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO statements (user_id, file_key, status)
    VALUES (${userId}, ${fileKey}, 'pending')
    RETURNING id
  `;
  return row.id;
}
