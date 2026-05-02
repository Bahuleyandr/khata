import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { verifyWebAppInitData } from "../auth/telegram-webapp.js";
import {
  resolveAccessForTelegramUser,
  resolveSessionAccessForTelegramUser,
  type AccessRole,
} from "../db/access.js";

// ─── Session helpers ─────────────────────────────────────────────────────────

export function signSession(userId: number, firstName: string, iat: number): string {
  const payload = `${userId}:${Buffer.from(firstName).toString("base64url")}:${iat}`;
  const hmac = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

export interface VerifiedSession {
  userId: number;
  firstName: string;
}

export interface AuthenticatedSession {
  userId: number;
  ledgerUserId: number;
  telegramUserId: number;
  actorUserId: number;
  firstName: string;
  role: AccessRole;
  isOwner: boolean;
}

const SESSION_MAX_AGE_S = 604800;
const TELEGRAM_LOGIN_MAX_AGE_S = 300;
const AUTH_FUTURE_SKEW_S = 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isConfigAllowedUser(userId: number): boolean {
  return config.allowedTelegramUserIds.includes(userId);
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function setSessionCookie(reply: FastifyReply, userId: number, firstName: string): void {
  reply.setCookie("session", signSession(userId, firstName, nowSeconds()), {
    httpOnly: true,
    sameSite: isProd() ? "none" : "lax",
    secure: isProd(),
    maxAge: SESSION_MAX_AGE_S,
    path: "/",
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie("session", {
    sameSite: isProd() ? "none" : "lax",
    secure: isProd(),
    path: "/",
  });
}

function verifySessionToken(token: string): VerifiedSession | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.substring(0, dot);
  const hmac = token.substring(dot + 1);
  const expected = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const userId = parseInt(parts[0]!, 10);
  const firstName = Buffer.from(parts[1]!, "base64url").toString("utf8");
  if (isNaN(userId)) return null;
  const iat = parseInt(parts[2]!, 10);
  const now = nowSeconds();
  if (isNaN(iat) || iat > now + AUTH_FUTURE_SKEW_S || now - iat > SESSION_MAX_AGE_S) {
    return null;
  }
  return { userId, firstName };
}

export function verifySession(token: string): VerifiedSession | null {
  const session = verifySessionToken(token);
  if (!session || !isConfigAllowedUser(session.userId)) return null;
  return session;
}

export async function getSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedSession | null> {
  const token = request.cookies["session"];
  if (!token) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
  const session = verifySessionToken(token);
  if (!session) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
  const access = await resolveSessionAccessForTelegramUser(session.userId, {
    firstName: session.firstName,
  });
  if (!access || access.status !== "active" || access.ledgerUserId === null) {
    reply.status(403).send({ error: "Access not approved yet" });
    return null;
  }
  return {
    userId: access.ledgerUserId,
    ledgerUserId: access.ledgerUserId,
    telegramUserId: session.userId,
    actorUserId: session.userId,
    firstName: session.firstName,
    role: access.role,
    isOwner: access.role === "owner",
  };
}

async function authenticateTelegramUser(
  userId: number,
  firstName: string,
  username?: string,
): Promise<AuthenticatedSession | null> {
  const access = await resolveAccessForTelegramUser(userId, {
    firstName,
    username,
  });
  if (!access || access.status !== "active" || access.ledgerUserId === null) return null;
  return {
    userId: access.ledgerUserId,
    ledgerUserId: access.ledgerUserId,
    telegramUserId: userId,
    actorUserId: userId,
    firstName,
    role: access.role,
    isOwner: access.role === "owner",
  };
}

// ─── Telegram auth helpers ────────────────────────────────────────────────────

export function verifyTelegramHash(data: Record<string, string>, hash: string): boolean {
  const secret = crypto.createHash("sha256").update(config.telegramBotToken).digest();
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const expected = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(hash.toLowerCase(), "hex"),
    );
  } catch {
    return false;
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/telegram
  app.post(
    "/api/auth/telegram",
    {
      schema: {
        body: {
          type: "object",
          required: ["id", "first_name", "auth_date", "hash"],
          additionalProperties: true,
          properties: {
            id: { type: "string", pattern: "^[0-9]+$" },
            first_name: { type: "string", minLength: 1, maxLength: 128 },
            auth_date: { type: "string", pattern: "^[0-9]+$" },
            hash: { type: "string", pattern: "^[A-Fa-f0-9]{64}$" },
          },
        },
      },
    },
    async (request, reply) => {
    const body = request.body as Record<string, string>;
    const { hash, ...data } = body;
    if (!hash) return reply.status(400).send({ error: "Missing hash" });

    const authDate = parseInt(data["auth_date"] ?? "0", 10);
    const now = nowSeconds();
    if (!authDate || Number.isNaN(authDate)) {
      return reply.status(400).send({ error: "Missing auth_date" });
    }
    if (authDate > now + AUTH_FUTURE_SKEW_S) {
      return reply.status(401).send({ error: "Auth token from the future" });
    }
    if (now - authDate > TELEGRAM_LOGIN_MAX_AGE_S) {
      return reply.status(401).send({ error: "Auth token expired" });
    }

    if (!verifyTelegramHash(data, hash)) {
      return reply.status(401).send({ error: "Invalid hash" });
    }

    const userId = parseInt(data["id"] ?? "", 10);
    const firstName = data["first_name"] ?? "";
    const session = await authenticateTelegramUser(userId, firstName, data["username"]);
    if (!session) {
      return reply.status(403).send({
        error: "Access not approved yet",
        telegram_user_id: userId,
      });
    }
    setSessionCookie(reply, userId, firstName);

    return { ok: true };
    },
  );

  // GET /api/me
  app.get("/api/me", async (request, reply) => {
    const token = request.cookies["session"];
    if (!token) return reply.status(401).send({ error: "Unauthorized" });
    const session = await getSession(request, reply);
    if (!session) return;
    return {
      telegram_user_id: session.telegramUserId,
      ledger_user_id: session.ledgerUserId,
      first_name: session.firstName,
      role: session.role,
      is_owner: session.isOwner,
    };
  });

  // POST /api/logout
  app.post("/api/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  // POST /api/auth/telegram-webapp — used by the Telegram Mini App. The
  // browser-side WebApp SDK exposes `Telegram.WebApp.initData` (a signed
  // query-string); we validate it server-side, allowlist-check, and issue
  // the same session cookie the Telegram-Login OAuth flow uses.
  app.post(
    "/api/auth/telegram-webapp",
    {
      schema: {
        body: {
          type: "object",
          required: ["initData"],
          additionalProperties: false,
          properties: {
            initData: { type: "string", minLength: 1, maxLength: 8192 },
          },
        },
      },
    },
    async (request, reply) => {
    const body = (request.body ?? {}) as { initData?: string };
    if (!body.initData) {
      return reply.status(400).send({ error: "Missing initData" });
    }

    const result = verifyWebAppInitData(body.initData);
    if (!result.ok) {
      return reply.status(401).send({ error: result.error });
    }

    const session = await authenticateTelegramUser(
      result.user.id,
      result.user.first_name,
      result.user.username,
    );
    if (!session) {
      return reply.status(403).send({
        error: "Access not approved yet",
        telegram_user_id: result.user.id,
      });
    }

    setSessionCookie(reply, result.user.id, result.user.first_name);
    return { ok: true };
    },
  );
}
