/**
 * Vitest globalSetup for integration tests.
 *
 * Starts a disposable Postgres:16-alpine container, runs migrations,
 * sets process.env.DATABASE_URL (and all other required config envs),
 * then tears down the container after the suite.
 *
 * If docker is unavailable: sets INTEGRATION_SKIP=1 and returns without error
 * — every test file checks that flag and skips the whole describe block.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const container = `khata-integration-${randomUUID().slice(0, 8)}`;
const dbName = "khata_integration";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

interface DockerCommand {
  cmd: string;
  prefixArgs: string[];
}

let dockerCommand: DockerCommand = { cmd: "docker", prefixArgs: [] };

async function detectDocker(): Promise<boolean> {
  // Try native docker first.
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
    });
    dockerCommand = { cmd: "docker", prefixArgs: [] };
    return true;
  } catch {
    // Fall through to WSL docker.
  }
  try {
    await execFileAsync("wsl", ["docker", "info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
    });
    dockerCommand = { cmd: "wsl", prefixArgs: ["docker"] };
    return true;
  } catch {
    return false;
  }
}

async function docker(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    dockerCommand.cmd,
    [...dockerCommand.prefixArgs, ...args],
    { windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
  );
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

async function waitForPostgres(port: string): Promise<void> {
  // pg_isready inside the container is the fastest check, but we also need the
  // port to be reachable from the Node process. Do both.
  for (let i = 0; i < 60; i += 1) {
    try {
      await execFileAsync(
        dockerCommand.cmd,
        [...dockerCommand.prefixArgs, "exec", container, "pg_isready", "-U", "postgres", "-d", dbName],
        { windowsHide: true },
      );
      // Also do a quick TCP probe so Node can actually connect.
      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const net = require("node:net") as typeof import("node:net");
        const sock = net.createConnection({ host: "127.0.0.1", port: Number(port) }, resolve);
        sock.on("error", reject);
        setTimeout(() => { sock.destroy(); reject(new Error("TCP timeout")); }, 2000);
      });
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("Postgres integration container did not become ready in time");
}

export async function setup(): Promise<void> {
  // ---------------------------------------------------------------------------
  // CI fast-path: use an externally-provided Postgres (e.g. a Forgejo Actions
  // service container) instead of spinning our own Docker container.
  // Set INTEGRATION_USE_EXISTING_DB=1 and DATABASE_URL=<connection string>.
  // ---------------------------------------------------------------------------
  if (process.env["INTEGRATION_USE_EXISTING_DB"] === "1") {
    const dbUrl = process.env["DATABASE_URL"];
    if (!dbUrl) {
      throw new Error(
        "[integration] INTEGRATION_USE_EXISTING_DB=1 requires DATABASE_URL to be set",
      );
    }
    console.log(`[integration] Using existing DB: ${dbUrl}`);

    // Set all env vars that the docker-spin path sets so config.ts is satisfied.
    // DATABASE_URL is already set by the caller — preserve it.
    process.env["TELEGRAM_BOT_TOKEN"] ??= "integration-test-token";
    process.env["ALLOWED_TELEGRAM_USER_IDS"] ??= [
      "99999",
      "10001", "10002", "10003",
      "20001", "20002", "20003", "20004", "20005",
      "30001", "30002", "30003", "30004", "30005",
      "40001", "40002",
    ].join(",");
    process.env["SESSION_SECRET"] ??= "integration-test-secret-that-is-at-least-32-chars-long";
    process.env["MINIMAX_API_KEY"] ??= "integration-test-minimax-key";
    process.env["S3_ENDPOINT"] ??= "http://localhost:9000";
    process.env["S3_BUCKET"] ??= "khata-integration";
    process.env["S3_REGION"] ??= "us-east-1";
    process.env["S3_ACCESS_KEY_ID"] ??= "test-access-key";
    process.env["S3_SECRET_ACCESS_KEY"] ??= "test-secret-key";
    process.env["ALLOWED_ORIGINS"] ??= "http://localhost:3000";

    console.log("[integration] Running migrations against existing DB...");
    const { stderr: migrateErr } = await execFileAsync(
      npmCmd,
      ["--prefix", "backend", "run", "migrate:dev"],
      {
        shell: process.platform === "win32",
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 20,
        env: { ...process.env },
        cwd: process.cwd().replace(/[\\/]backend$/, ""),
      },
    );
    if (migrateErr?.trim()) process.stderr.write(migrateErr);
    console.log("[integration] Migrations complete (existing DB).");

    // Signal teardown to skip container removal.
    process.env["_INTEGRATION_CONTAINER"] = "";
    return;
  }

  // ---------------------------------------------------------------------------
  // Local path: detect Docker and spin a disposable container (unchanged).
  // ---------------------------------------------------------------------------
  const hasDocker = await detectDocker();
  if (!hasDocker) {
    console.warn("[integration] Docker not available — skipping integration tests.");
    process.env["INTEGRATION_SKIP"] = "1";
    return;
  }

  console.log(`[integration] Starting container ${container}`);
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
    // ephemeral port on all interfaces — avoids WSL2 ECONNREFUSE with fixed
    // 127.0.0.1 binding; we discover the actual port via `docker port`.
    "-p",
    "0.0.0.0::5432",
    "postgres:16-alpine",
  ]);

  // Discover the mapped port.
  // `docker port <container> 5432/tcp` returns "0.0.0.0:PORT\n:::PORT\n" or just
  // "0.0.0.0:PORT\n"; we want the first IPv4 line.
  let portOutput = "";
  for (let i = 0; i < 20; i++) {
    try {
      const raw = await execFileAsync(
        dockerCommand.cmd,
        [...dockerCommand.prefixArgs, "port", container, "5432/tcp"],
        { windowsHide: true },
      );
      portOutput = raw.stdout.trim();
      if (portOutput) break;
    } catch {
      await sleep(500);
    }
  }
  const ipv4Line = portOutput.split("\n").find((l) => l.startsWith("0.0.0.0:") || l.match(/^\d/));
  const port = ipv4Line?.split(":").pop()?.trim();
  if (!port) throw new Error(`Could not discover mapped Postgres port from: ${portOutput}`);

  console.log(`[integration] Postgres at 127.0.0.1:${port}/${dbName}`);
  await waitForPostgres(port);

  const databaseUrl = `postgres://postgres@127.0.0.1:${port}/${dbName}`;

  // Set all required env vars before importing config (which runs at module-load time).
  process.env["DATABASE_URL"] = databaseUrl;
  process.env["TELEGRAM_BOT_TOKEN"] = "integration-test-token";
  // Include all test user IDs used across integration test files.
  // DB-level tests use 10001-10003, 20001-20005, route-level tests use 30001-30005.
  // Receipt/merge uuid=text regression tests use 40001-40002.
  process.env["ALLOWED_TELEGRAM_USER_IDS"] = [
    "99999",
    "10001", "10002", "10003",
    "20001", "20002", "20003", "20004", "20005",
    "30001", "30002", "30003", "30004", "30005",
    "40001", "40002",
  ].join(",");
  process.env["SESSION_SECRET"] = "integration-test-secret-that-is-at-least-32-chars-long";
  process.env["MINIMAX_API_KEY"] = "integration-test-minimax-key";
  process.env["S3_ENDPOINT"] = "http://localhost:9000";
  process.env["S3_BUCKET"] = "khata-integration";
  process.env["S3_REGION"] = "us-east-1";
  process.env["S3_ACCESS_KEY_ID"] = "test-access-key";
  process.env["S3_SECRET_ACCESS_KEY"] = "test-secret-key";
  // allowedOrigins default covers http://localhost:3000 (CSRF guard)
  process.env["ALLOWED_ORIGINS"] = "http://localhost:3000";

  console.log("[integration] Running migrations...");
  const { stderr: migrateErr } = await execFileAsync(
    npmCmd,
    ["--prefix", "backend", "run", "migrate:dev"],
    {
      shell: process.platform === "win32",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
      env: { ...process.env },
      cwd: process.cwd().replace(/[\\/]backend$/, ""),
    },
  );
  if (migrateErr?.trim()) process.stderr.write(migrateErr);
  console.log("[integration] Migrations complete.");

  // Store container name for teardown.
  process.env["_INTEGRATION_CONTAINER"] = container;
}

export async function teardown(): Promise<void> {
  const c = process.env["_INTEGRATION_CONTAINER"];
  // When using an existing DB (INTEGRATION_USE_EXISTING_DB=1), _INTEGRATION_CONTAINER
  // is set to "" — skip removal. When docker-spin path was used, it holds a container name.
  if (c) {
    console.log(`[integration] Removing container ${c}`);
    await execFileAsync(
      dockerCommand.cmd,
      [...dockerCommand.prefixArgs, "rm", "-f", c],
      { windowsHide: true },
    ).catch(() => {});
  }
}
