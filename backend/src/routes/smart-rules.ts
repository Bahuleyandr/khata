import type { FastifyInstance } from "fastify";
import { accountBelongsToUser } from "../db/accounts.js";
import { recordAuditEvent } from "../db/audit.js";
import { sql } from "../db/index.js";
import {
  createSmartRule,
  deleteSmartRule,
  listSmartRules,
  updateSmartRule,
  type SmartRuleInput,
  type SmartRulePatchInput,
} from "../db/smart-rules.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const smartRuleProperties = {
  name: { type: "string", minLength: 1, maxLength: 120 },
  priority: { type: "integer", minimum: 0, maximum: 10000 },
  enabled: { type: "boolean" },
  match_scope: { type: "string", enum: ["merchant", "description", "raw_text", "any"] },
  match_type: { type: "string", enum: ["contains", "equals", "regex"] },
  pattern: { type: "string", minLength: 1, maxLength: 240 },
  category_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
  account_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
  tag_names: {
    type: "array",
    maxItems: 20,
    items: { type: "string", minLength: 1, maxLength: 80 },
  },
  review_status: {
    anyOf: [{ type: "string", enum: ["needs_review", "reviewed", "ignored"] }, { type: "null" }],
  },
} as const;

const createSmartRuleSchema = {
  type: "object",
  required: ["name", "pattern"],
  additionalProperties: false,
  properties: smartRuleProperties,
} as const;

const patchSmartRuleSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: smartRuleProperties,
} as const;

const smartRuleParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

async function categoryBelongsToUser(userId: number, categoryId: string): Promise<boolean> {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT id FROM categories
    WHERE id = ${categoryId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return !!row;
}

async function validateTargets(userId: number, input: { category_id?: string | null; account_id?: string | null }) {
  if (input.category_id && !(await categoryBelongsToUser(userId, input.category_id))) {
    return "Category not found";
  }
  if (input.account_id && !(await accountBelongsToUser(userId, input.account_id))) {
    return "Account not found";
  }
  return null;
}

export async function smartRulesRoutes(app: FastifyInstance) {
  app.get("/api/rules", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    return { rules: await listSmartRules(session.userId) };
  });

  app.post<{ Body: SmartRuleInput }>(
    "/api/rules",
    { schema: { body: createSmartRuleSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const targetError = await validateTargets(session.userId, request.body);
      if (targetError) return reply.status(400).send({ error: targetError });
      try {
        const rule = await createSmartRule(session.userId, request.body);
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "rule.create",
          entityType: "smart_rule",
          entityId: rule.id,
          after: rule,
        });
        return reply.status(201).send(rule);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode) return reply.status(statusCode).send({ error: (err as Error).message });
        if ((err as { code?: string }).code === "23505") {
          return reply.status(409).send({ error: "Rule already exists" });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: SmartRulePatchInput }>(
    "/api/rules/:id",
    { schema: { params: smartRuleParamsSchema, body: patchSmartRuleSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const targetError = await validateTargets(session.userId, request.body);
      if (targetError) return reply.status(400).send({ error: targetError });
      const before = (await listSmartRules(session.userId)).find((rule) => rule.id === request.params.id);
      try {
        const rule = await updateSmartRule(session.userId, request.params.id, request.body);
        if (!rule) return reply.status(404).send({ error: "Rule not found" });
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "rule.update",
          entityType: "smart_rule",
          entityId: rule.id,
          before,
          after: rule,
        });
        return rule;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode) return reply.status(statusCode).send({ error: (err as Error).message });
        if ((err as { code?: string }).code === "23505") {
          return reply.status(409).send({ error: "Rule already exists" });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/rules/:id",
    { schema: { params: smartRuleParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const before = (await listSmartRules(session.userId)).find((rule) => rule.id === request.params.id);
      const deleted = await deleteSmartRule(session.userId, request.params.id);
      if (!deleted) return reply.status(404).send({ error: "Rule not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "rule.delete",
        entityType: "smart_rule",
        entityId: request.params.id,
        before,
      });
      return { ok: true };
    },
  );
}
