import type { FastifyInstance } from "fastify";
import {
  archiveAccount,
  createAccount,
  listAccounts,
  updateAccount,
  type AccountType,
} from "../db/accounts.js";
import { recordAuditEvent } from "../db/audit.js";
import { getSession } from "./auth.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const accountBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    type: { type: "string", enum: ["bank", "card", "cash", "wallet", "upi", "other"] },
    institution: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
    last_four: { anyOf: [{ type: "string", maxLength: 16 }, { type: "null" }] },
    is_default: { type: "boolean" },
  },
} as const;

const accountPatchSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: accountBodySchema.properties,
} as const;

const accountParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

const accountQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    include_archived: { type: "boolean" },
  },
} as const;

type AccountBody = {
  name: string;
  type?: AccountType;
  institution?: string | null;
  last_four?: string | null;
  is_default?: boolean;
};

type AccountPatchBody = Partial<AccountBody>;

export async function accountsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { include_archived?: boolean } }>(
    "/api/accounts",
    { schema: { querystring: accountQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      return { accounts: await listAccounts(session.userId, { includeArchived: request.query.include_archived }) };
    },
  );

  app.post<{ Body: AccountBody }>(
    "/api/accounts",
    { schema: { body: accountBodySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      try {
        const account = await createAccount(session.userId, request.body);
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "account.create",
          entityType: "account",
          entityId: account.id,
          after: account,
        });
        return reply.status(201).send(account);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          return reply.status(409).send({ error: "Account already exists" });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: AccountPatchBody }>(
    "/api/accounts/:id",
    { schema: { params: accountParamsSchema, body: accountPatchSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      try {
        const before = (await listAccounts(session.userId, { includeArchived: true })).find(
          (account) => account.id === request.params.id,
        );
        const account = await updateAccount(session.userId, request.params.id, request.body);
        if (!account) return reply.status(404).send({ error: "Account not found" });
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "account.update",
          entityType: "account",
          entityId: account.id,
          before,
          after: account,
        });
        return account;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          return reply.status(409).send({ error: "Account already exists" });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/accounts/:id",
    { schema: { params: accountParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      const before = (await listAccounts(session.userId, { includeArchived: true })).find(
        (account) => account.id === request.params.id,
      );
      const account = await archiveAccount(session.userId, request.params.id);
      if (!account) return reply.status(404).send({ error: "Account not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "account.archive",
        entityType: "account",
        entityId: account.id,
        before,
        after: account,
      });
      return { ok: true, account };
    },
  );
}
