/**
 * Simple migration runner: executes SQL files in order from db/migrations/.
 * Each migration is tracked in schema_migrations table by filename.
 * Safe to re-run (idempotent — skips already-applied migrations).
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = postgres(config.databaseUrl, { connection: { timezone: "Asia/Kolkata" } });

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Track a content checksum so an already-applied migration that is later
  // edited is caught instead of silently diverging from the live schema
  // (audit 2026-06-19 M6). Added via ALTER so existing DBs upgrade in place;
  // rows applied before this change have NULL checksum and skip the check.
  await sql`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`;

  // One-time rename guard: update old filenames to new filenames if present
  const renames: Array<[string, string]> = [
    ['002_statement_status.sql', '003_statement_status.sql'],
    ['003_receipt_ocr.sql', '006_receipt_ocr.sql'],
    ['004_receipt_ocr.sql', '006_receipt_ocr.sql'],
    ['005_receipt_ocr.sql', '006_receipt_ocr.sql'],
    ['006_bot_sessions.sql', '005_bot_sessions.sql'],
  ];
  for (const [oldName, newName] of renames) {
    await sql`
      UPDATE schema_migrations SET filename = ${newName}
      WHERE filename = ${oldName}
        AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = ${newName})
    `;
  }

  const migrationsDir = join(__dirname, "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const body = await readFile(join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const [existing] = await sql<Array<{ checksum: string | null }>>`
      SELECT checksum FROM schema_migrations WHERE filename = ${file}
    `;
    if (existing) {
      if (existing.checksum && existing.checksum !== checksum) {
        throw new Error(
          `Migration ${file} was modified after being applied (checksum mismatch). ` +
            `Migrations are append-only — create a new migration instead of editing this one.`,
        );
      }
      console.log(`  skip  ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (filename, checksum) VALUES (${file}, ${checksum})`;
    });
    console.log(`  apply ${file}`);
  }

  // Provision the least-privilege app role's LOGIN password from the
  // environment (audit 2026-06-19 M5). The role is created by migration 035;
  // its password is set here so it never lives in a migration file. Skipped
  // when APP_DB_PASSWORD is unset (e.g. trust-auth CI / smoke).
  const appDbPassword = process.env["APP_DB_PASSWORD"];
  if (appDbPassword) {
    const [role] = await sql<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM pg_roles WHERE rolname = 'khata_app'
    `;
    if (role) {
      const escaped = appDbPassword.replace(/'/g, "''");
      await sql.unsafe(`ALTER ROLE khata_app WITH LOGIN PASSWORD '${escaped}'`);
      console.log("Provisioned khata_app role password.");
    } else {
      console.warn("APP_DB_PASSWORD set but khata_app role missing — ensure migration 035 applied.");
    }
  }

  await sql.end();
  console.log("Migrations complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
