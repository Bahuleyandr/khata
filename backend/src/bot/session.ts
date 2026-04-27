import { sql } from "../db/index.js";

export interface PendingEdit {
  expenseId: string;
  amount_cents: number;
  currency: string;
  category: string;
  description: string;
  occurred_at: Date;
  waitingFor?: "amount" | "date";
}

export async function getPendingEdit(userId: number): Promise<PendingEdit | undefined> {
  const key = `edit:${userId}`;
  const rows = await sql<{ payload: Record<string, unknown> }[]>`
    SELECT payload FROM bot_sessions
    WHERE session_key = ${key} AND expires_at > NOW()
  `;
  if (!rows[0]) return undefined;
  const raw = rows[0].payload;
  return {
    ...(raw as unknown as PendingEdit),
    occurred_at: new Date(raw["occurred_at"] as string),
  };
}

export async function setPendingEdit(userId: number, data: PendingEdit): Promise<void> {
  const key = `edit:${userId}`;
  const payload = JSON.stringify(data);
  await sql`
    INSERT INTO bot_sessions (session_key, kind, payload, expires_at)
    VALUES (${key}, 'pending_edit', ${payload}::jsonb, NOW() + INTERVAL '30 minutes')
    ON CONFLICT (session_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          expires_at = NOW() + INTERVAL '30 minutes'
  `;
}

export async function clearPendingEdit(userId: number): Promise<void> {
  const key = `edit:${userId}`;
  await sql`DELETE FROM bot_sessions WHERE session_key = ${key}`;
}
