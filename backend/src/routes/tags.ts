import type { FastifyInstance } from "fastify";
import {
  attachTagToExpense,
  detachTagFromExpense,
  expenseBelongsToUser,
  getOrCreateTag,
  listTagsWithCounts,
  tagBelongsToUser,
} from "../db/tags.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const expenseParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

const tagParamsSchema = {
  type: "object",
  required: ["id", "tagId"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
    tagId: { type: "string", pattern: uuidPattern },
  },
} as const;

const tagBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
  },
} as const;

export async function tagsRoutes(app: FastifyInstance) {
  app.get("/api/tags", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    return { tags: await listTagsWithCounts(session.userId) };
  });

  app.post<{ Params: { id: string }; Body: { name: string } }>(
    "/api/expenses/:id/tags",
    { schema: { params: expenseParamsSchema, body: tagBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!(await expenseBelongsToUser(request.params.id, session.userId))) {
        return reply.status(404).send({ error: "Transaction not found" });
      }
      const tagId = await getOrCreateTag(session.userId, request.body.name);
      if (!tagId) return reply.status(400).send({ error: "Invalid tag" });
      await attachTagToExpense(request.params.id, tagId);
      return { ok: true, tag_id: tagId };
    },
  );

  app.delete<{ Params: { id: string; tagId: string } }>(
    "/api/expenses/:id/tags/:tagId",
    { schema: { params: tagParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const [hasExpense, hasTag] = await Promise.all([
        expenseBelongsToUser(request.params.id, session.userId),
        tagBelongsToUser(request.params.tagId, session.userId),
      ]);
      if (!hasExpense || !hasTag) return reply.status(404).send({ error: "Tag not found" });
      const removed = await detachTagFromExpense(request.params.id, request.params.tagId);
      if (!removed) return reply.status(404).send({ error: "Tag not attached" });
      return { ok: true };
    },
  );
}
