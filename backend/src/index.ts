import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { config } from "./config.js";
import { sql } from "./db/index.js";
import { bot } from "./bot/index.js";
import { startBudgetCrons } from "./cron/budgets.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { shutdownMcp } from "./ai/mcp.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
});

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

await app.register(dashboardRoutes);

startBudgetCrons(bot.api);

// Bot runs in long-polling mode (no public webhook needed → works behind NAT
// and on Tailscale-only deployments). Drop any leftover webhook registration
// from a prior deploy before starting the polling loop.
async function startBotPolling(): Promise<void> {
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
  } catch (err) {
    app.log.warn({ err }, "deleteWebhook failed (ignoring)");
  }
  void bot
    .start({
      onStart: () => app.log.info("Telegram bot polling started"),
    })
    .catch((err) => {
      app.log.error({ err }, "bot polling crashed");
      process.exit(1);
    });
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
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
