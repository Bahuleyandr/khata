import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { config } from "./config.js";
import { sql } from "./db/index.js";
import { bot, installMiniAppMenuButton } from "./bot/index.js";
import { startBudgetCrons } from "./cron/budgets.js";
import { startInsightsCron } from "./cron/insights.js";
import { startHealthCron } from "./cron/health.js";
import { startBotHeartbeat, livenessStatus, getLastBotOkAt } from "./bot/heartbeat.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { shutdownMcp } from "./ai/mcp.js";
import { dashboardCorsOptions } from "./http/cors.js";

const app = Fastify({ logger: true });

await app.register(cors, dashboardCorsOptions());

await app.register(cookie);

app.get("/health", async (_request, reply) => {
  try {
    await sql`SELECT 1`;
    return { status: "ok", db: "ok" };
  } catch (err) {
    app.log.error({ err }, "health check: db probe failed");
    reply.status(503);
    return { status: "degraded", db: "unreachable" };
  }
});

// Liveness probe (k8s livenessProbe → here; readiness stays on /health). Fails
// only on an unreachable DB or a confirmed-stale bot poller, so a wedged bot
// triggers a pod restart while a low-traffic-but-healthy bot ("starting"/"ok")
// and a brief Telegram blip do not (audit 2026-06-19 M9).
app.get("/live", async (_request, reply) => {
  const bot = livenessStatus(getLastBotOkAt(), Date.now());
  let db: "ok" | "unreachable" = "ok";
  try {
    await sql`SELECT 1`;
  } catch (err) {
    app.log.error({ err }, "live check: db probe failed");
    db = "unreachable";
  }
  if (db !== "ok" || bot === "stale") {
    reply.status(503);
    return { status: "degraded", db, bot };
  }
  return { status: "ok", db, bot };
});

await app.register(dashboardRoutes);

startBudgetCrons(bot.api);
startInsightsCron();
startHealthCron(bot.api);

let stopBotHeartbeat: (() => void) | null = null;

// Bot runs in long-polling mode (no public webhook needed → works behind NAT
// and on Tailscale-only deployments). Drop any leftover webhook registration
// from a prior deploy before starting the polling loop.
async function startBotPolling(): Promise<void> {
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
  } catch (err) {
    app.log.warn({ err }, "deleteWebhook failed (ignoring)");
  }
  // Best-effort — registers the Mini App chat menu button if MINI_APP_URL is
  // configured; logs and continues otherwise.
  await installMiniAppMenuButton().catch((err) =>
    app.log.warn({ err }, "Mini App menu install failed"),
  );
  void bot
    .start({
      onStart: () => app.log.info("Telegram bot polling started"),
    })
    .catch((err) => {
      app.log.error({ err }, "bot polling crashed");
      process.exit(1);
    });

  // Bot liveness heartbeat feeds /live (audit 2026-06-19 M9).
  stopBotHeartbeat = startBotHeartbeat(
    () => bot.api.getMe(),
    (err) => app.log.warn({ err }, "bot heartbeat getMe failed"),
  );
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  stopBotHeartbeat?.();
  try {
    await bot.stop();
  } catch (err) {
    app.log.warn({ err }, "bot.stop() failed");
  }
  await shutdownMcp();
  await app.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  await startBotPolling();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
