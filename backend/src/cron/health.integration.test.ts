/**
 * Integration tests for the ops health cron DB helpers.
 * Exercises: backup_runs insert/query, restore_drills query, ops_health_state
 * shouldAlert transition logic, capture_events 24 h window.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "../test-support/db-helpers.js";
import {
  getLatestBackupRun,
  getDrillHealth,
  getRecentCaptureStats,
  shouldAlert,
} from "./health.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";

// Truncate only the tables this test touches — avoids FK issues with full
// truncateAll (which would need access_users/ledgers seeded).
async function cleanOpsHealthTables(): Promise<void> {
  await sql.unsafe(`TRUNCATE backup_runs, ops_health_state RESTART IDENTITY CASCADE`);
  // capture_events has FKs to expenses/access_users; delete rather than truncate.
  await sql.unsafe(`DELETE FROM capture_events`);
  await sql.unsafe(`DELETE FROM restore_drills`);
}

describe.skipIf(skip)("ops health: backup_runs", () => {
  beforeEach(async () => {
    await cleanOpsHealthTables();
  });

  afterAll(async () => {
    // Pool stays open; let the global teardown close it.
  });

  it("getLatestBackupRun returns null when no rows exist", async () => {
    const result = await getLatestBackupRun("postgres");
    expect(result).toBeNull();
  });

  it("getLatestBackupRun returns the most-recent ok row", async () => {
    // Insert older ok, then newer ok.
    await sql.unsafe(
      `INSERT INTO backup_runs (kind, status, created_at)
       VALUES ('postgres', 'ok', NOW() - INTERVAL '2 hours')`,
    );
    await sql.unsafe(
      `INSERT INTO backup_runs (kind, status, created_at)
       VALUES ('postgres', 'ok', NOW() - INTERVAL '1 hour')`,
    );
    const result = await getLatestBackupRun("postgres");
    expect(result).not.toBeNull();
    // Should be ~1h ago, not 2h ago.
    const ageMs = Date.now() - result!.getTime();
    expect(ageMs).toBeLessThan(90 * 60 * 1000); // < 90 min → it's the recent one
    expect(ageMs).toBeGreaterThan(30 * 60 * 1000); // > 30 min
  });

  it("getLatestBackupRun excludes 'failed' rows", async () => {
    // Only a failed row — should still return null for ok runs.
    await sql.unsafe(
      `INSERT INTO backup_runs (kind, status, created_at)
       VALUES ('postgres', 'failed', NOW() - INTERVAL '1 hour')`,
    );
    const result = await getLatestBackupRun("postgres");
    expect(result).toBeNull();
  });

  it("getLatestBackupRun is scoped to the requested kind", async () => {
    await sql.unsafe(
      `INSERT INTO backup_runs (kind, status, created_at)
       VALUES ('minio', 'ok', NOW() - INTERVAL '1 hour')`,
    );
    const pg = await getLatestBackupRun("postgres");
    const minio = await getLatestBackupRun("minio");
    expect(pg).toBeNull();
    expect(minio).not.toBeNull();
  });
});

describe.skipIf(skip)("ops health: getDrillHealth", () => {
  beforeEach(async () => {
    await cleanOpsHealthTables();
  });

  it("returns nulls when no rows exist", async () => {
    const result = await getDrillHealth();
    expect(result.latestStatus).toBeNull();
    expect(result.lastPassedAt).toBeNull();
  });

  it("latestStatus reflects the newest row; lastPassedAt is the newest passed row", async () => {
    // Insert a passed row (older).
    await sql.unsafe(
      `INSERT INTO restore_drills (status, checked_at, created_at)
       VALUES ('passed', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days')`,
    );
    // Insert a failed row (newer).
    await sql.unsafe(
      `INSERT INTO restore_drills (status, checked_at, created_at)
       VALUES ('failed', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')`,
    );

    const result = await getDrillHealth();
    // Latest row is the failed one.
    expect(result.latestStatus).toBe("failed");
    // lastPassedAt is the passed row, even though it's older.
    expect(result.lastPassedAt).not.toBeNull();
    const ageMs = Date.now() - result.lastPassedAt!.getTime();
    expect(ageMs).toBeGreaterThan(2 * 24 * 60 * 60 * 1000); // > 2 days
    expect(ageMs).toBeLessThan(4 * 24 * 60 * 60 * 1000); // < 4 days
  });

  it("lastPassedAt is null when there are only failed rows", async () => {
    await sql.unsafe(
      `INSERT INTO restore_drills (status, checked_at, created_at)
       VALUES ('failed', NOW(), NOW())`,
    );
    const result = await getDrillHealth();
    expect(result.latestStatus).toBe("failed");
    expect(result.lastPassedAt).toBeNull();
  });
});

describe.skipIf(skip)("ops health: getRecentCaptureStats", () => {
  beforeEach(async () => {
    await cleanOpsHealthTables();
  });

  it("returns 0/0 when no rows exist", async () => {
    const result = await getRecentCaptureStats();
    expect(result.failedCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it("counts failed and total capture_events in the last 24 h", async () => {
    // 2 failed + 1 processed within 24h.
    await sql.unsafe(
      `INSERT INTO capture_events (user_id, source, status, created_at)
       VALUES
         (99999, 'telegram_text', 'failed',    NOW() - INTERVAL '1 hour'),
         (99999, 'telegram_text', 'failed',    NOW() - INTERVAL '2 hours'),
         (99999, 'telegram_text', 'processed', NOW() - INTERVAL '3 hours')`,
    );
    const result = await getRecentCaptureStats();
    expect(result.failedCount).toBe(2);
    expect(result.totalCount).toBe(3);
  });

  it("excludes events older than 24 h", async () => {
    // One event older than 25h — should be excluded.
    await sql.unsafe(
      `INSERT INTO capture_events (user_id, source, status, created_at)
       VALUES (99999, 'telegram_text', 'failed', NOW() - INTERVAL '25 hours')`,
    );
    const result = await getRecentCaptureStats();
    expect(result.failedCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

describe.skipIf(skip)("ops health: shouldAlert transition logic", () => {
  beforeEach(async () => {
    await cleanOpsHealthTables();
  });

  it("healthy signal → no alert, state upserted as ok", async () => {
    const fire = await shouldAlert("backup_postgres", true);
    expect(fire).toBe(false);

    const rows = await sql<Array<{ current_status: string }>>`
      SELECT current_status FROM ops_health_state WHERE ops_kind = 'backup_postgres'
    `;
    expect(rows[0]?.current_status).toBe("ok");
  });

  it("ok → degraded fires alert (transition)", async () => {
    // Seed as ok first.
    await shouldAlert("backup_postgres", true);

    const fire = await shouldAlert("backup_postgres", false);
    expect(fire).toBe(true);

    const rows = await sql<Array<{ current_status: string }>>`
      SELECT current_status FROM ops_health_state WHERE ops_kind = 'backup_postgres'
    `;
    expect(rows[0]?.current_status).toBe("degraded");
  });

  it("degraded → degraded does NOT fire again (suppress repeat)", async () => {
    await shouldAlert("backup_postgres", true);  // ok
    await shouldAlert("backup_postgres", false); // first alert (ok→degraded)
    const fire = await shouldAlert("backup_postgres", false); // already degraded
    expect(fire).toBe(false);
  });

  it("degraded → ok → degraded fires again (new transition)", async () => {
    await shouldAlert("backup_postgres", true);  // ok
    await shouldAlert("backup_postgres", false); // alert fires
    await shouldAlert("backup_postgres", true);  // back to ok
    const fire = await shouldAlert("backup_postgres", false); // new degradation
    expect(fire).toBe(true);
  });

  it("absent state → first degraded signal fires alert", async () => {
    // No prior state row — should alert on first degraded signal.
    const fire = await shouldAlert("restore_drill", false);
    expect(fire).toBe(true);
  });

  it("different ops_kinds are independent", async () => {
    await shouldAlert("backup_postgres", true);   // pg ok
    await shouldAlert("backup_minio", false);     // minio degraded (first time → fires)

    const pgFire = await shouldAlert("backup_postgres", false); // pg: ok→degraded → fires
    const minioFire = await shouldAlert("backup_minio", false); // minio: already degraded → suppressed
    expect(pgFire).toBe(true);
    expect(minioFire).toBe(false);
  });
});
