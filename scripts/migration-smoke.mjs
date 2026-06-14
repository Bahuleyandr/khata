import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const container = `khata-migration-smoke-${randomUUID().slice(0, 8)}`;
const dbName = "khata_smoke";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
let dockerCommand = { cmd: "docker", prefixArgs: [] };

async function detectDocker() {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
    });
    dockerCommand = { cmd: "docker", prefixArgs: [] };
    return;
  } catch {
    // Windows developer machines may keep Docker inside WSL2 only.
  }
  await execFileAsync("wsl", ["docker", "info", "--format", "{{.ServerVersion}}"], {
    windowsHide: true,
  });
  dockerCommand = { cmd: "wsl", prefixArgs: ["docker"] };
}

async function run(cmd, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10,
    ...options,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

async function cleanup() {
  await execFileAsync(dockerCommand.cmd, [...dockerCommand.prefixArgs, "rm", "-f", container], {
    windowsHide: true,
  }).catch(() => {});
}

function docker(args) {
  return run(dockerCommand.cmd, [...dockerCommand.prefixArgs, ...args]);
}

async function waitForPostgres() {
  for (let i = 0; i < 45; i += 1) {
    try {
      await docker(["exec", container, "pg_isready", "-U", "postgres", "-d", dbName]);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("Postgres smoke container did not become ready in time");
}

async function psql(sqlText, { expectError = false } = {}) {
  const args = [
    ...dockerCommand.prefixArgs,
    "exec",
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    dbName,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    sqlText,
  ];
  try {
    const { stdout } = await execFileAsync(dockerCommand.cmd, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
    if (expectError) throw new Error(`Expected SQL to error but it succeeded: ${sqlText}`);
    return stdout.trim();
  } catch (err) {
    if (expectError) return String(err.stderr ?? err.message ?? err);
    throw err;
  }
}

/**
 * Behavioural check for migration 025: a 'closed' month must be immutable, and
 * 'reopened' must restore writes. A DB trigger is the only place this can be
 * asserted (the unit suite mocks `sql`), so it lives in the smoke gate.
 */
async function assertMonthCloseImmutability() {
  console.log("Verifying month-close immutability trigger...");
  await psql(
    "INSERT INTO expenses (user_id, amount_cents, occurred_at) VALUES (999, 10000, '2026-04-15T12:00:00Z')",
  );
  await psql(
    "INSERT INTO monthly_closes (user_id, period_month, status) VALUES (999, '2026-04-01', 'closed')",
  );

  for (const [label, stmt] of [
    ["edit", "UPDATE expenses SET amount_cents = 99999 WHERE user_id = 999"],
    ["delete", "DELETE FROM expenses WHERE user_id = 999"],
    [
      "insert",
      "INSERT INTO expenses (user_id, amount_cents, occurred_at) VALUES (999, 500, '2026-04-20T12:00:00Z')",
    ],
  ]) {
    const out = await psql(stmt, { expectError: true });
    if (!/KHATA_MONTH_CLOSED/.test(out)) {
      throw new Error(`Closed-month ${label} was NOT blocked by the trigger`);
    }
  }

  // Reopening the period must restore writes.
  await psql("UPDATE monthly_closes SET status = 'reopened' WHERE user_id = 999");
  await psql("UPDATE expenses SET amount_cents = 77777 WHERE user_id = 999");
  const amount = await psql("SELECT amount_cents FROM expenses WHERE user_id = 999");
  if (amount !== "77777") {
    throw new Error(`Reopened-month edit did not apply (got ${amount})`);
  }
  console.log("Month-close immutability trigger verified.");
}

/**
 * Migration 027: the database default timezone must be Asia/Kolkata, and the
 * close trigger must bucket occurred_at in IST (not the session TZ). The
 * boundary instant 2026-06-30T20:30:00Z == 2026-07-01 02:00 IST must be treated
 * as JULY: closing June must NOT block it, closing July MUST block it.
 */
async function assertTimezoneBucketing() {
  console.log("Verifying timezone default + IST month bucketing...");

  const tz = await psql("SHOW timezone");
  if (tz !== "Asia/Kolkata") {
    throw new Error(`Expected DB default timezone Asia/Kolkata, got '${tz}'`);
  }

  await psql(
    "INSERT INTO expenses (user_id, amount_cents, occurred_at) VALUES (998, 10000, '2026-06-30T20:30:00Z')",
  );

  // Closing JUNE must NOT block it (the expense is July in IST).
  await psql(
    "INSERT INTO monthly_closes (user_id, period_month, status) VALUES (998, '2026-06-01', 'closed')",
  );
  await psql("UPDATE expenses SET amount_cents = 10001 WHERE user_id = 998");
  const afterJune = await psql("SELECT amount_cents FROM expenses WHERE user_id = 998");
  if (afterJune !== "10001") {
    throw new Error(`June close wrongly blocked a July-IST expense (got ${afterJune})`);
  }

  // Closing JULY must block it.
  await psql(
    "INSERT INTO monthly_closes (user_id, period_month, status) VALUES (998, '2026-07-01', 'closed')",
  );
  const out = await psql("UPDATE expenses SET amount_cents = 20000 WHERE user_id = 998", {
    expectError: true,
  });
  if (!/KHATA_MONTH_CLOSED/.test(out)) {
    throw new Error("July close did NOT block a July-IST boundary expense");
  }

  console.log("Timezone default + IST bucketing verified.");
}

/**
 * Migration 028: updated_at trigger must fire on UPDATE, stamping a strictly
 * greater timestamp than the inserted value. Uses user_id 997 to avoid
 * colliding with 998/999 used by other assertions.
 */
async function assertUpdatedAtTrigger() {
  console.log("Verifying updated_at trigger on expenses...");

  await psql(
    "INSERT INTO expenses (user_id, amount_cents, occurred_at) VALUES (997, 5000, '2026-05-01T10:00:00Z')",
  );
  const insertedUpdatedAt = await psql(
    "SELECT updated_at FROM expenses WHERE user_id = 997",
  );
  if (!insertedUpdatedAt) {
    throw new Error("updated_at not populated after insert");
  }

  // Small sleep so the DB clock advances at least 1 ms before the UPDATE.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await psql("UPDATE expenses SET amount_cents = 6000 WHERE user_id = 997");
  const afterUpdateUpdatedAt = await psql(
    "SELECT updated_at FROM expenses WHERE user_id = 997",
  );

  const inserted = new Date(insertedUpdatedAt).getTime();
  const afterUpdate = new Date(afterUpdateUpdatedAt).getTime();
  if (afterUpdate <= inserted) {
    throw new Error(
      `updated_at trigger did not advance: inserted=${insertedUpdatedAt} afterUpdate=${afterUpdateUpdatedAt}`,
    );
  }
  console.log("updated_at trigger verified.");
}

async function main() {
  console.log(`Starting disposable Postgres container ${container}`);
  await detectDocker();
  await docker([
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    `POSTGRES_DB=${dbName}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);

  await waitForPostgres();

  const port = (
    await docker(["port", container, "5432/tcp"])
  ).trim().split(":").pop();
  if (!port) throw new Error("Could not discover mapped Postgres port");

  console.log(`Running migrations on postgres://postgres@127.0.0.1:${port}/${dbName}`);
  await run(npmCmd, ["--prefix", "backend", "run", "migrate:dev"], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/${dbName}`,
      TELEGRAM_BOT_TOKEN: "test-token",
      ALLOWED_TELEGRAM_USER_IDS: "12345",
      SESSION_SECRET: "test-secret-that-is-at-least-32-chars-long",
      MINIMAX_API_KEY: "test-minimax-key",
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "khata-smoke",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    },
  });

  await assertMonthCloseImmutability();
  await assertTimezoneBucketing();
  await assertUpdatedAtTrigger();

  console.log("Migration smoke passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
