import type { FastifyInstance } from "fastify";
import { listAuditEvents, undoAuditEvent } from "../db/audit.js";
import { getSession } from "./auth.js";

const auditQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    action: { type: "string", minLength: 1, maxLength: 120 },
    entity_type: { type: "string", minLength: 1, maxLength: 80 },
    entity_id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
  },
} as const;

type AuditQuery = {
  limit?: number;
  action?: string;
  entity_type?: string;
  entity_id?: string;
};

const auditParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
  },
} as const;

export async function auditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuditQuery }>(
    "/api/audit-log",
    { schema: { querystring: auditQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      // The full forensic edit history (before/after of every money change) is
      // owner-only; a lower-privilege household member must not read it.
      if (!session.canManage) return reply.status(403).send({ error: "Owner access required" });

      return {
        events: await listAuditEvents(session.userId, {
          limit: request.query.limit ?? 50,
          action: request.query.action,
          entityType: request.query.entity_type,
          entityId: request.query.entity_id,
        }),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/audit-log/:id/undo",
    { schema: { params: auditParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!session.canManage) return reply.status(403).send({ error: "Owner access required" });
      try {
        const event = await undoAuditEvent(
          session.userId,
          session.actorUserId ?? session.userId,
          request.params.id,
        );
        return { ok: true, event };
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode) return reply.status(statusCode).send({ error: (err as Error).message });
        throw err;
      }
    },
  );
}
