import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { authRoutes } from "./auth.js";
import { expensesRoutes } from "./expenses.js";
import { receiptsRoutes } from "./receipts.js";
import { exportRoutes } from "./export.js";
import { insightsRoutes } from "./insights.js";
import { categoriesRoutes } from "./categories.js";
import { budgetsRoutes } from "./budgets.js";
import { tagsRoutes } from "./tags.js";
import { statementsRoutes } from "./statements.js";
import { monthlyReviewRoutes } from "./monthly-review.js";
import { installCsrfOriginGuard } from "./csrf.js";

export async function dashboardRoutes(app: FastifyInstance) {
  await installCsrfOriginGuard(app);
  await app.register(multipart);
  await app.register(authRoutes);
  await app.register(expensesRoutes);
  await app.register(receiptsRoutes);
  await app.register(exportRoutes);
  await app.register(insightsRoutes);
  await app.register(categoriesRoutes);
  await app.register(budgetsRoutes);
  await app.register(tagsRoutes);
  await app.register(statementsRoutes);
  await app.register(monthlyReviewRoutes);
}
