import { sql } from "../db/index.js";
import type { PendingImport } from "./types.js";

const KIND = "pending_import";

function key(chatId: number): string {
  return `stmt:${chatId}`;
}

export async function setPendingImport(chatId: number, data: PendingImport): Promise<void> {
  await sql`
    INSERT INTO bot_sessions (session_key, kind, payload, expires_at)
    VALUES (${key(chatId)}, ${KIND}, ${sql.json(data as never)}, NOW() + INTERVAL '30 minutes')
    ON CONFLICT (session_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at
  `;
}

export async function getPendingImport(chatId: number): Promise<PendingImport | undefined> {
  const rows = await sql<{ payload: PendingImport }[]>`
    SELECT payload FROM bot_sessions
    WHERE session_key = ${key(chatId)}
      AND kind = ${KIND}
      AND expires_at > NOW()
  `;
  return rows[0]?.payload;
}

export async function clearPendingImport(chatId: number): Promise<void> {
  await sql`DELETE FROM bot_sessions WHERE session_key = ${key(chatId)}`;
}
