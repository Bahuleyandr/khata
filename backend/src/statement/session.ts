import { sql } from "../db/index.js";
import type { PendingImport } from "./types.js";

export async function setPendingImport(chatId: number, data: PendingImport): Promise<void> {
  const key = `stmt:${chatId}`;
  const payload = JSON.stringify(data);
  await sql`
    INSERT INTO bot_sessions (session_key, kind, payload, expires_at)
    VALUES (${key}, 'pending_import', ${payload}::jsonb, NOW() + INTERVAL '30 minutes')
    ON CONFLICT (session_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          expires_at = NOW() + INTERVAL '30 minutes'
  `;
}

export async function getPendingImport(chatId: number): Promise<PendingImport | undefined> {
  const key = `stmt:${chatId}`;
  const rows = await sql<{ payload: PendingImport }[]>`
    SELECT payload FROM bot_sessions
    WHERE session_key = ${key} AND expires_at > NOW()
  `;
  return rows[0]?.payload;
}

export async function clearPendingImport(chatId: number): Promise<void> {
  const key = `stmt:${chatId}`;
  await sql`DELETE FROM bot_sessions WHERE session_key = ${key}`;
}
