import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.js";
import { expensesRoutes } from "./expenses.js";
import { receiptsRoutes } from "./receipts.js";
import { exportRoutes } from "./export.js";
import { insightsRoutes } from "./insights.js";
import { installCsrfOriginGuard } from "./csrf.js";

export async function dashboardRoutes(app: FastifyInstance) {
  await installCsrfOriginGuard(app);
  await app.register(authRoutes);
  await app.register(expensesRoutes);
  await app.register(receiptsRoutes);
  await app.register(exportRoutes);
  await app.register(insightsRoutes);
}
