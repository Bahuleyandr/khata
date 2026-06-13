import type { FastifyInstance } from "fastify";
import { accountBelongsToUser } from "../db/accounts.js";
import { computeMonthlyReconciliation } from "../db/reconciliation.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const reconciliationQuerySchema = {
  type: "object",
  required: ["year", "month"],
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
    account_id: { type: "string", pattern: uuidPattern },
  },
} as const;

type ReconciliationQuery = {
  year: number;
  month: number;
  account_id?: string;
};

export async function reconciliationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ReconciliationQuery }>(
    "/api/reconciliation/monthly",
    { schema: { querystring: reconciliationQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (
        request.query.account_id &&
        !(await accountBelongsToUser(session.userId, request.query.account_id))
      ) {
        return reply.status(400).send({ error: "Account not found" });
      }
      return computeMonthlyReconciliation(
        session.userId,
        request.query.year,
        request.query.month,
        request.query.account_id ?? null,
      );
    },
  );
}
