import postgres from "postgres";
import { config } from "../config.js";

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // India-only app: evaluate date_trunc / ::date / CURRENT_DATE in IST. The
  // authoritative default is migration 027 (ALTER DATABASE); pinning it on the
  // pool makes the intent explicit and covers a fresh DB before that migration
  // has run. If a postgres.js version ignores this option the migrated DB
  // default still applies.
  connection: { timezone: "Asia/Kolkata" },
});
