/**
 * Simple migration runner: executes SQL files in order from db/migrations/.
 * Each migration is tracked in schema_migrations table by filename.
 * Safe to re-run (idempotent — skips already-applied migrations).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = postgres(config.databaseUrl);

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

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
    const [existing] = await sql`
      SELECT filename FROM schema_migrations WHERE filename = ${file}
    `;
    if (existing) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const body = await readFile(join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    });
    console.log(`  apply ${file}`);
  }

  await sql.end();
  console.log("Migrations complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
