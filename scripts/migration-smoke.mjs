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
    await execFileAsync("docker", ["--version"], { windowsHide: true });
    dockerCommand = { cmd: "docker", prefixArgs: [] };
    return;
  } catch {
    // Windows developer machines may keep Docker inside WSL2 only.
  }
  await execFileAsync("wsl", ["docker", "--version"], { windowsHide: true });
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
    "POSTGRES_PASSWORD=postgres",
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

  console.log(`Running migrations on postgres://postgres:postgres@127.0.0.1:${port}/${dbName}`);
  await run(npmCmd, ["--prefix", "backend", "run", "migrate:dev"], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/${dbName}`,
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

  console.log("Migration smoke passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
