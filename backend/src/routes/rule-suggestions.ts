import type { FastifyInstance } from "fastify";
import {
  acceptRuleSuggestion,
  dismissRuleSuggestion,
  listRuleSuggestions,
  type RuleSuggestionStatus,
} from "../db/rule-suggestions.js";
import { recordAuditEvent } from "../db/audit.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const suggestionQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["pending", "accepted", "dismissed"] },
  },
} as const;

const suggestionParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

export async function ruleSuggestionsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: RuleSuggestionStatus } }>(
    "/api/rule-suggestions",
    { schema: { querystring: suggestionQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      return {
        suggestions: await listRuleSuggestions(session.userId, request.query.status ?? "pending"),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/rule-suggestions/:id/accept",
    { schema: { params: suggestionParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      try {
        const result = await acceptRuleSuggestion(session.userId, request.params.id);
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "rule_suggestion.accept",
          entityType: "rule_suggestion",
          entityId: result.suggestion.id,
          after: result.suggestion,
          metadata: { smart_rule_id: result.rule.id },
        });
        return { ok: true, ...result };
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode) return reply.status(statusCode).send({ error: (err as Error).message });
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/rule-suggestions/:id/dismiss",
    { schema: { params: suggestionParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const suggestion = await dismissRuleSuggestion(session.userId, request.params.id);
      if (!suggestion) return reply.status(404).send({ error: "Suggestion not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "rule_suggestion.dismiss",
        entityType: "rule_suggestion",
        entityId: suggestion.id,
        after: suggestion,
      });
      return { ok: true, suggestion };
    },
  );
}
