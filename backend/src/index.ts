import Fastify from "fastify";
import { config } from "./config.js";
import { telegramRoutes } from "./routes/telegram.js";
import { bot } from "./bot/index.js";
import { startBudgetCrons } from "./cron/budgets.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

await app.register(telegramRoutes);

startBudgetCrons(bot.api);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
