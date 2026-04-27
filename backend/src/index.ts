import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { config } from "./config.js";
import { telegramRoutes } from "./routes/telegram.js";
import { bot } from "./bot/index.js";
import { startBudgetCrons } from "./cron/budgets.js";
import { dashboardRoutes } from "./routes/dashboard.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
});

await app.register(cookie);

app.get("/health", async () => ({ status: "ok" }));

await app.register(telegramRoutes);
await app.register(dashboardRoutes);

startBudgetCrons(bot.api);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
