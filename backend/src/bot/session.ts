import { sql } from "../db/index.js";

export interface PendingEdit {
  expenseId: string;
  ledgerUserId?: number;
  amount_cents: number;
  currency: string;
  category: string;
  description: string;
  occurred_at: Date;
  waitingFor?: "amount" | "date";
}

const KIND = "pending_edit";

function key(userId: number): string {
  return `edit:${userId}`;
}

export async function getPendingEdit(userId: number): Promise<PendingEdit | undefined> {
  const rows = await sql<{ payload: PendingEdit }[]>`
    SELECT payload FROM bot_sessions
    WHERE session_key = ${key(userId)}
      AND kind = ${KIND}
      AND expires_at > NOW()
  `;
  const row = rows[0];
  if (!row) return undefined;
  const p = row.payload;
  return { ...p, occurred_at: new Date(p.occurred_at as unknown as string) };
}

export async function setPendingEdit(userId: number, data: PendingEdit): Promise<void> {
  const payload = { ...data, occurred_at: data.occurred_at.toISOString() };
  await sql`
    INSERT INTO bot_sessions (session_key, kind, payload, expires_at)
    VALUES (${key(userId)}, ${KIND}, ${sql.json(payload as never)}, NOW() + INTERVAL '30 minutes')
    ON CONFLICT (session_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at
  `;
}

export async function clearPendingEdit(userId: number): Promise<void> {
  await sql`DELETE FROM bot_sessions WHERE session_key = ${key(userId)}`;
}
