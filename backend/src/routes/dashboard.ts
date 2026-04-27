import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.js";
import { expensesRoutes } from "./expenses.js";
import { receiptsRoutes } from "./receipts.js";

export async function dashboardRoutes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(expensesRoutes);
  await app.register(receiptsRoutes);
}
