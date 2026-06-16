import { schedule } from "node-cron";
import { Api } from "grammy";
import { sql } from "../db/index.js";
import { config } from "../config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Pure predicates — no I/O, easily unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the most-recent successful backup is within maxAgeHours of
 * nowMs. null latestCreatedAt → false (no successful backup ever recorded).
 */
export function isBackupFresh(
  latestCreatedAt: Date | null,
  nowMs: number,
  maxAgeHours = 26,
): boolean {
  if (latestCreatedAt === null) return false;
  const ageMs = nowMs - latestCreatedAt.getTime();
  return ageMs < maxAgeHours * 60 * 60 * 1000;
}

/**
 * Returns true when the restore drill is considered healthy:
 *   - Latest drill row status must be 'passed'
 *   - The last time it passed must be within maxStaleDays of nowMs
 * Any null input → false.
 */
export function isDrillHealthy(
  latestStatus: string | null,
  lastPassedAt: Date | null,
  nowMs: number,
  maxStaleDays = 8,
): boolean {
  if (latestStatus === null || lastPassedAt === null) return false;
  if (latestStatus !== "passed") return false;
  const ageMs = nowMs - lastPassedAt.getTime();
  return ageMs < maxStaleDays * 24 * 60 * 60 * 1000;
}

/**
 * Returns true when capture failures are bad enough to warrant an alert:
 *   - failedCount must reach absThreshold (absolute floor), AND
 *   - failedCount/totalCount must reach pctThreshold (fraction, e.g. 0.5 = 50%)
 * 0 total → false (nothing to judge). Below abs threshold → false.
 */
export function isCaptureUnhealthy(
  failedCount: number,
  totalCount: number,
  absThreshold = 5,
  pctThreshold = 0.5,
): boolean {
  if (failedCount < absThreshold) return false;
  if (totalCount === 0) return false;
  return failedCount / totalCount >= pctThreshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB query helpers — module-internal (exported for testing only).
// ─────────────────────────────────────────────────────────────────────────────

/** Latest created_at for a successful backup of the given kind. */
export async function getLatestBackupRun(kind: "postgres" | "minio"): Promise<Date | null> {
  const rows = await sql<Array<{ created_at: Date }>>`
    SELECT created_at
    FROM backup_runs
    WHERE kind = ${kind} AND status = 'ok'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0]?.created_at ?? null;
}

/** Latest drill row's status + the checked_at of the most recent 'passed' row. */
export async function getDrillHealth(): Promise<{
  latestStatus: string | null;
  lastPassedAt: Date | null;
}> {
  const latestRows = await sql<Array<{ status: string }>>`
    SELECT status
    FROM restore_drills
    ORDER BY checked_at DESC
    LIMIT 1
  `;
  const latestStatus = latestRows[0]?.status ?? null;

  const passedRows = await sql<Array<{ checked_at: Date }>>`
    SELECT checked_at
    FROM restore_drills
    WHERE status = 'passed'
    ORDER BY checked_at DESC
    LIMIT 1
  `;
  const lastPassedAt = passedRows[0]?.checked_at ?? null;

  return { latestStatus, lastPassedAt };
}

/** Count of failed + total capture_events in the last 24 hours. */
export async function getRecentCaptureStats(): Promise<{
  failedCount: number;
  totalCount: number;
}> {
  const rows = await sql<Array<{ failed_count: string; total_count: string }>>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
      COUNT(*) AS total_count
    FROM capture_events
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  `;
  const row = rows[0];
  return {
    failedCount: parseInt(row?.failed_count ?? "0", 10),
    totalCount: parseInt(row?.total_count ?? "0", 10),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication: alert only on transition ok→degraded.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks ops_health_state for opsKind.
 * - If nowHealthy: upsert current_status='ok' + last_ok_at. Return false.
 * - If unhealthy: upsert current_status='degraded' + last_alerted_at. Return
 *   true ONLY if the previous state was 'ok' or absent (first-time alert).
 *   Subsequent calls while still degraded return false (suppress repeats).
 */
export async function shouldAlert(opsKind: string, nowHealthy: boolean): Promise<boolean> {
  if (nowHealthy) {
    await sql`
      INSERT INTO ops_health_state (ops_kind, current_status, last_ok_at, updated_at)
      VALUES (${opsKind}, 'ok', NOW(), NOW())
      ON CONFLICT (ops_kind) DO UPDATE
        SET current_status = 'ok',
            last_ok_at = NOW(),
            updated_at = NOW()
    `;
    return false;
  }

  // Unhealthy — check prior state before updating.
  const prior = await sql<Array<{ current_status: string }>>`
    SELECT current_status FROM ops_health_state WHERE ops_kind = ${opsKind}
  `;
  const wasOkOrAbsent = prior.length === 0 || prior[0]?.current_status === "ok";

  await sql`
    INSERT INTO ops_health_state (ops_kind, current_status, last_alerted_at, updated_at)
    VALUES (${opsKind}, 'degraded', NOW(), NOW())
    ON CONFLICT (ops_kind) DO UPDATE
      SET current_status = 'degraded',
          last_alerted_at = NOW(),
          updated_at = NOW()
  `;

  return wasOkOrAbsent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main check orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function runOpsHealthCheck(botApi: Api): Promise<void> {
  const ownerId = config.allowedTelegramUserIds[0];
  if (ownerId === undefined) {
    console.error("runOpsHealthCheck: no owner in allowedTelegramUserIds — skipping");
    return;
  }

  const nowMs = Date.now();

  // Gather all signals concurrently.
  const [pgLatest, minioLatest, drillHealth, captureStats] = await Promise.all([
    getLatestBackupRun("postgres"),
    getLatestBackupRun("minio"),
    getDrillHealth(),
    getRecentCaptureStats(),
  ]);

  const pgFresh = isBackupFresh(pgLatest, nowMs, 26);
  const minioFresh = isBackupFresh(minioLatest, nowMs, 26);
  const drillOk = isDrillHealthy(drillHealth.latestStatus, drillHealth.lastPassedAt, nowMs, 8);
  const captureOk = !isCaptureUnhealthy(captureStats.failedCount, captureStats.totalCount);

  // Evaluate each signal; collect alert lines for those that just transitioned.
  const checks: Array<[opsKind: string, ok: boolean, alertLine: string]> = [
    [
      "backup_postgres",
      pgFresh,
      pgLatest === null
        ? "🔴 *Postgres backup*: no successful run ever recorded."
        : `🔴 *Postgres backup*: last OK was ${pgLatest.toISOString()} (> 26 h ago).`,
    ],
    [
      "backup_minio",
      minioFresh,
      minioLatest === null
        ? "🔴 *MinIO backup*: no successful run ever recorded."
        : `🔴 *MinIO backup*: last OK was ${minioLatest.toISOString()} (> 26 h ago).`,
    ],
    [
      "restore_drill",
      drillOk,
      drillHealth.latestStatus === null
        ? "🔴 *Restore drill*: no drill rows found."
        : drillHealth.latestStatus === "failed"
          ? `🔴 *Restore drill*: last run FAILED (checked ${drillHealth.lastPassedAt?.toISOString() ?? "never"} for last pass).`
          : `🔴 *Restore drill*: last pass was > 8 days ago (${drillHealth.lastPassedAt?.toISOString() ?? "never"}).`,
    ],
    [
      "capture_failures",
      captureOk,
      `🔴 *Capture failures*: ${captureStats.failedCount}/${captureStats.totalCount} events failed in last 24 h (≥50% & ≥5 absolute).`,
    ],
  ];

  const alertLines: string[] = [];
  for (const [opsKind, ok, line] of checks) {
    const fire = await shouldAlert(opsKind, ok);
    if (fire) alertLines.push(line);
  }

  if (alertLines.length === 0) return;

  const message =
    "⚠️ *Khata Ops Health*\n\n" + alertLines.join("\n\n");

  try {
    await botApi.sendMessage(ownerId, message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("runOpsHealthCheck: failed to send Telegram DM:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daily at 20:00 UTC — runs after the pg-backup @18:30, minio-backup @18:45,
 * and Sunday restore-drill @19:30, so all fresh data is available.
 */
export function startHealthCron(botApi: Api): void {
  schedule("0 20 * * *", () => {
    runOpsHealthCheck(botApi).catch((err) =>
      console.error("Ops health cron error:", err),
    );
  });
  console.log("Ops health cron registered: daily @20:00 UTC.");
}
