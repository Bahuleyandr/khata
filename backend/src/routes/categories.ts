import type { FastifyInstance } from "fastify";
import {
  addCategoryRow,
  deleteCategoryById,
  renameCategoryById,
} from "../db/categories.js";
import { recordAuditEvent } from "../db/audit.js";
import { sql } from "../db/index.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const categoryBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const categoryParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

export async function categoriesRoutes(app: FastifyInstance) {
  app.post<{ Body: { name: string } }>(
    "/api/categories",
    { schema: { body: categoryBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const row = await addCategoryRow(session.userId, request.body.name);
      if (!row) return reply.status(409).send({ error: "Category already exists" });
      await recordAuditEvent({
        userId: session.userId,
        action: "category.create",
        entityType: "category",
        entityId: row.id,
        after: row,
      });
      return reply.status(201).send(row);
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/categories/:id",
    { schema: { params: categoryParamsSchema, body: categoryBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const [before] = await sql<Array<{ id: string; name: string; is_default: boolean }>>`
        SELECT id, name, is_default
        FROM categories
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
        LIMIT 1
      `;
      const row = await renameCategoryById(session.userId, request.params.id, request.body.name);
      if (!row) return reply.status(404).send({ error: "Category not found" });
      await recordAuditEvent({
        userId: session.userId,
        action: "category.update",
        entityType: "category",
        entityId: row.id,
        before: before ?? null,
        after: row,
      });
      return row;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/categories/:id",
    { schema: { params: categoryParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const [before] = await sql<Array<{ id: string; name: string; is_default: boolean }>>`
        SELECT id, name, is_default
        FROM categories
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
        LIMIT 1
      `;
      const deleted = await deleteCategoryById(session.userId, request.params.id);
      if (!deleted) return reply.status(404).send({ error: "Category not found or default" });
      await recordAuditEvent({
        userId: session.userId,
        action: "category.delete",
        entityType: "category",
        entityId: request.params.id,
        before: before ?? { id: request.params.id },
      });
      return { ok: true };
    },
  );
}
