import type { FastifyInstance } from "fastify";
import {
  grantAccessUser,
  listAccessUsers,
  revokeAccessUser,
  updateAccessUserRole,
  type AccessRole,
  type LedgerMember,
} from "../db/access.js";
import { recordAuditEvent } from "../db/audit.js";
import { getSession } from "./auth.js";

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serializeAccessUser(user: LedgerMember) {
  return {
    telegram_user_id: user.telegramUserId,
    first_name: user.firstName,
    username: user.username,
    role: user.role,
    status: user.status,
    ledger_id: user.ledgerId,
    ledger_name: user.ledgerName,
    ledger_kind: user.ledgerKind,
    ledger_user_id: user.ledgerUserId,
    invited_by: user.invitedBy,
    can_view: user.canView,
    can_add: user.canAdd,
    can_manage: user.canManage,
    created_at: serializeDate(user.createdAt)!,
    updated_at: serializeDate(user.updatedAt)!,
    last_login_at: serializeDate(user.lastLoginAt),
    revoked_at: serializeDate(user.revokedAt),
  };
}

function boolOrDefault(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export async function accessRoutes(app: FastifyInstance) {
  app.get("/api/access/users", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    if (!session.canManage) {
      return reply.status(403).send({ error: "Only ledger owners can manage access" });
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
            can_view: { type: "boolean" },
            can_add: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!session.canManage) {
        return reply.status(403).send({ error: "Only ledger owners can manage access" });
      }

      const body = request.body as {
        telegram_user_id: number | string;
        first_name?: string;
        username?: string;
        role?: AccessRole;
        can_view?: boolean;
        can_add?: boolean;
      };
      const telegramUserId = Number(body.telegram_user_id);
      if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
        return reply.status(400).send({ error: "Invalid Telegram user ID" });
      }

      const user = await grantAccessUser({
        ledgerId: session.userId,
        actorUserId: session.actorUserId,
        telegramUserId,
        firstName: body.first_name,
        username: body.username,
        role: body.role ?? "member",
        canView: boolOrDefault(body.can_view, true),
        canAdd: boolOrDefault(body.can_add, true),
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
          additionalProperties: false,
          minProperties: 1,
          properties: {
            role: { type: "string", enum: ["owner", "member"] },
            can_view: { type: "boolean" },
            can_add: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (!session.canManage) {
        return reply.status(403).send({ error: "Only ledger owners can manage access" });
      }

      const params = request.params as { telegramUserId: string };
      const body = request.body as { role?: AccessRole; can_view?: boolean; can_add?: boolean };
      const telegramUserId = Number(params.telegramUserId);
      const before = (await listAccessUsers(session.userId)).find((user) => user.telegramUserId === telegramUserId) ?? null;
      const user = await updateAccessUserRole({
        ledgerId: session.userId,
        actorUserId: session.actorUserId,
        telegramUserId,
        role: body.role,
        canView: body.can_view,
        canAdd: body.can_add,
      });
      if (!user) return reply.status(404).send({ error: "Access user not found" });

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "access.update",
        entityType: "access_user",
        before: before ? serializeAccessUser(before) : null,
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
      if (!session.canManage) {
        return reply.status(403).send({ error: "Only ledger owners can manage access" });
      }

      const params = request.params as { telegramUserId: string };
      const telegramUserId = Number(params.telegramUserId);
      const before = (await listAccessUsers(session.userId)).find((user) => user.telegramUserId === telegramUserId) ?? null;
      const user = await revokeAccessUser({
        ledgerId: session.userId,
        actorUserId: session.actorUserId,
        telegramUserId,
      });
      if (!user) return reply.status(404).send({ error: "Access user not found" });

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "access.revoke",
        entityType: "access_user",
        before: before ? serializeAccessUser(before) : null,
        after: serializeAccessUser(user),
      });

      return { ok: true, user: serializeAccessUser(user) };
    },
  );
}
