import type { FastifyInstance } from "fastify";
import { recordAuditEvent } from "../db/audit.js";
import { clearBudget, getBudgetsWithMtd, setBudget } from "../db/budgets.js";
import { sql } from "../db/index.js";
import { getSession } from "./auth.js";
import { yearMonthIst } from "../lib/time.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const monthPattern = "^\\d{4}-\\d{2}$";

function currentYearMonth(): string {
  return yearMonthIst();
}

async function categoryBelongsToUser(userId: number, categoryId: string): Promise<boolean> {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT id FROM categories
    WHERE id = ${categoryId} AND user_id = ${userId}
    LIMIT 1
  `;
  return !!row;
}

const budgetsQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    month: { type: "string", pattern: monthPattern },
  },
} as const;

const budgetBodySchema = {
  type: "object",
  required: ["category_id", "target_cents"],
  additionalProperties: false,
  properties: {
    category_id: { type: "string", pattern: uuidPattern },
    target_cents: { type: "integer", minimum: 1, maximum: 999999999999 },
  },
} as const;

const budgetParamsSchema = {
  type: "object",
  required: ["categoryId"],
  additionalProperties: false,
  properties: {
    categoryId: { type: "string", pattern: uuidPattern },
  },
} as const;

export async function budgetsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { month?: string } }>(
    "/api/budgets",
    { schema: { querystring: budgetsQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const month = request.query.month ?? currentYearMonth();
      return { budgets: await getBudgetsWithMtd(session.userId, month), month };
    },
  );

  app.post<{ Body: { category_id: string; target_cents: number } }>(
    "/api/budgets",
    { schema: { body: budgetBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!(await categoryBelongsToUser(session.userId, request.body.category_id))) {
        return reply.status(400).send({ error: "Category not found" });
      }
      const [before] = await sql<Array<{ id: string; category_id: string; target_cents: string; period: string }>>`
        SELECT id, category_id, target_cents::text AS target_cents, period
        FROM category_budgets
        WHERE user_id = ${session.userId}
          AND category_id = ${request.body.category_id}
          AND period = 'monthly'
        LIMIT 1
      `;
      await setBudget(session.userId, request.body.category_id, request.body.target_cents);
      const [after] = await sql<Array<{ id: string; category_id: string; target_cents: string; period: string }>>`
        SELECT id, category_id, target_cents::text AS target_cents, period
        FROM category_budgets
        WHERE user_id = ${session.userId}
          AND category_id = ${request.body.category_id}
          AND period = 'monthly'
        LIMIT 1
      `;
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "budget.set",
        entityType: "budget",
        entityId: request.body.category_id,
        before: before ?? null,
        after: after ?? {
          category_id: request.body.category_id,
          target_cents: String(request.body.target_cents),
          period: "monthly",
        },
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { categoryId: string } }>(
    "/api/budgets/:categoryId",
    { schema: { params: budgetParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const [before] = await sql<Array<{ id: string; category_id: string; target_cents: string; period: string }>>`
        SELECT id, category_id, target_cents::text AS target_cents, period
        FROM category_budgets
        WHERE user_id = ${session.userId}
          AND category_id = ${request.params.categoryId}
          AND period = 'monthly'
        LIMIT 1
      `;
      const deleted = await clearBudget(session.userId, request.params.categoryId);
      if (!deleted) return reply.status(404).send({ error: "Budget not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "budget.clear",
        entityType: "budget",
        entityId: request.params.categoryId,
        before: before ?? { category_id: request.params.categoryId, period: "monthly" },
      });
      return { ok: true };
    },
  );
}
