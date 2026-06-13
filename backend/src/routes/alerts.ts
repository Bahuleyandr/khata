import type { FastifyInstance } from "fastify";
import { dismissUserAlert, listUserAlerts } from "../db/alerts.js";
import { recordAuditEvent } from "../db/audit.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const alertsQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    include_resolved: { type: "boolean" },
  },
} as const;

const alertParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

export async function alertsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { include_resolved?: boolean } }>(
    "/api/alerts",
    { schema: { querystring: alertsQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      return {
        alerts: await listUserAlerts(session.userId, {
          includeResolved: request.query.include_resolved,
        }),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/alerts/:id/dismiss",
    { schema: { params: alertParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const alert = await dismissUserAlert(session.userId, request.params.id);
      if (!alert) return reply.status(404).send({ error: "Alert not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "alert.dismiss",
        entityType: "alert",
        entityId: alert.id,
        after: alert,
      });
      return { ok: true, alert };
    },
  );
}
