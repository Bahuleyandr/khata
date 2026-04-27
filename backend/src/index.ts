import Fastify from "fastify";
import { config } from "./config.js";
import { telegramRoutes } from "./routes/telegram.js";
import { sql } from "./db/index.js";
import { checkBucketHealth } from "./storage/index.js";
import { getLastClaudeSuccess } from "./ai/health.js";

const app = Fastify({ logger: true });

app.get("/health", async (_, reply) => {
  const checks: Record<string, "ok" | "error" | "unknown"> = {};
  let healthy = true;

  // Postgres liveness check
  try {
    await sql`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "error";
    healthy = false;
  }

  // R2 bucket reachability check
  try {
    await checkBucketHealth();
    checks.r2 = "ok";
  } catch {
    checks.r2 = "error";
    healthy = false;
  }

  // Anthropic: report last successful call timestamp (avoids paid API ping on every probe)
  const lastClaude = getLastClaudeSuccess();
  checks.anthropic = lastClaude ? "ok" : "unknown";

  reply.code(healthy ? 200 : 503);
  return {
    status: healthy ? "ok" : "degraded",
    checks,
    anthropicLastSuccess: lastClaude?.toISOString() ?? null,
  };
});

await app.register(telegramRoutes);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
