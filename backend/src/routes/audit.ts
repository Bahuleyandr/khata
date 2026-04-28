import type { FastifyInstance } from "fastify";
import { listAuditEvents } from "../db/audit.js";
import { getSession } from "./auth.js";

const auditQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

export async function auditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: number } }>(
    "/api/audit-log",
    { schema: { querystring: auditQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      return { events: await listAuditEvents(session.userId, request.query.limit ?? 50) };
    },
  );
}
