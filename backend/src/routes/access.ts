import type { FastifyInstance } from "fastify";
import {
  grantAccessUser,
  listAccessUsers,
  revokeAccessUser,
  updateAccessUserRole,
  type AccessRole,
} from "../db/access.js";
import { recordAuditEvent } from "../db/audit.js";
import { getSession } from "./auth.js";

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serializeAccessUser(user: Awaited<ReturnType<typeof listAccessUsers>>[number]) {
  return {
    telegram_user_id: user.telegramUserId,
    first_name: user.firstName,
    username: user.username,
    role: user.role,
    status: user.status,
    ledger_user_id: user.ledgerUserId,
    invited_by: user.invitedBy,
    created_at: serializeDate(user.createdAt)!,
    updated_at: serializeDate(user.updatedAt)!,
    last_login_at: serializeDate(user.lastLoginAt),
    revoked_at: serializeDate(user.revokedAt),
  };
}

export async function accessRoutes(app: FastifyInstance) {
  app.get("/api/access/users", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    if (!session.isOwner) {
      return reply.status(403).send({ error: "Only owners can manage access" });
    }

    const users = await listAccessUsers(session.userId);
    return { users: users.map(serializeAccessUser) };
  });

  app.post(
    "/api/access/users",
    {
      schema: {
        body: {
          type: "object",
          required: ["telegram_user_id"],
          additionalProperties: false,
          properties: {
            telegram_user_id: { anyOf: [{ type: "integer" }, { type: "string", pattern: "^[0-9]+$" }] },
            first_name: { type: "string", maxLength: 128 },
            username: { type: "string", maxLength: 128 },
            role: { type: "string", enum: ["owner", "member"] },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!session.isOwner) {
        return reply.status(403).send({ error: "Only owners can manage access" });
      }

      const body = request.body as {
        telegram_user_id: number | string;
        first_name?: string;
        username?: string;
        role?: AccessRole;
      };
      const telegramUserId = Number(body.telegram_user_id);
      if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
        return reply.status(400).send({ error: "Invalid Telegram user ID" });
      }

      const user = await grantAccessUser({
        ledgerUserId: session.userId,
        actorUserId: session.actorUserId,
        telegramUserId,
        firstName: body.first_name,
        username: body.username,
        role: body.role ?? "member",
      });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "access.grant",
        entityType: "access_user",
        before: null,
        after: serializeAccessUser(user),
      });

      reply.status(201);
      return serializeAccessUser(user);
    },
  );

  app.patch(
    "/api/access/users/:telegramUserId",
    {
      schema: {
        params: {
          type: "object",
          required: ["telegramUserId"],
          properties: {
            telegramUserId: { type: "string", pattern: "^[0-9]+$" },
          },
        },
        body: {
          type: "object",
          required: ["role"],
          additionalProperties: false,
          properties: {
            role: { type: "string", enum: ["owner", "member"] },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!session.isOwner) {
        return reply.status(403).send({ error: "Only owners can manage access" });
      }

      const params = request.params as { telegramUserId: string };
      const body = request.body as { role: AccessRole };
      const telegramUserId = Number(params.telegramUserId);
      const user = await updateAccessUserRole({
        ledgerUserId: session.userId,
        actorUserId: session.actorUserId,
        telegramUserId,
        role: body.role,
      });
      if (!user) return reply.status(404).send({ error: "Access user not found" });

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "access.update",
        entityType: "access_user",
        before: null,
        after: serializeAccessUser(user),
      });

      return serializeAccessUser(user);
    },
  );

  app.delete(
    "/api/access/users/:telegramUserId",
    {
      schema: {
        params: {
          type: "object",
          required: ["telegramUserId"],
          properties: {
            telegramUserId: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!session.isOwner) {
        return reply.status(403).send({ error: "Only owners can manage access" });
      }

      const params = request.params as { telegramUserId: string };
      const telegramUserId = Number(params.telegramUserId);
      const user = await revokeAccessUser({
        ledgerUserId: session.userId,
        actorUserId: session.actorUserId,
        telegramUserId,
      });
      if (!user) return reply.status(404).send({ error: "Access user not found" });

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "access.revoke",
        entityType: "access_user",
        before: null,
        after: serializeAccessUser(user),
      });

      return { ok: true, user: serializeAccessUser(user) };
    },
  );
}
