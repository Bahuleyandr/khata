import { sql } from "./index.js";

export interface RestoreDrillRow {
  id: string;
  status: "pending" | "running" | "passed" | "failed";
  backup_key: string | null;
  checked_at: Date;
  duration_ms: number | null;
  detail: Record<string, unknown>;
  error_reason: string | null;
  created_at: Date;
}

export async function listRestoreDrills(limit = 10): Promise<RestoreDrillRow[]> {
  return sql<RestoreDrillRow[]>`
    SELECT id,
           status,
           backup_key,
           checked_at,
           duration_ms,
           detail,
           error_reason,
           created_at
    FROM restore_drills
    ORDER BY checked_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 25)}
  `;
}
