import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { verifyWebAppInitData } from "../auth/telegram-webapp.js";
import {
  listLedgersForTelegramUser,
  resolveLedgerForTelegramUser,
  resolveAccessForTelegramUser,
  resolveSessionAccessForTelegramUser,
  setSessionsInvalidBefore,
  type AccessRole,
  type LedgerKind,
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
  iat: number;
}

export interface AuthenticatedSession {
  userId: number;
  ledgerUserId: number;
  personalLedgerId: number;
  telegramUserId: number;
  actorUserId: number;
  firstName: string;
  role: AccessRole;
  isOwner: boolean;
  selectedLedgerId: number;
  selectedLedgerName: string;
  selectedLedgerKind: LedgerKind;
  canView: boolean;
  canAdd: boolean;
  canManage: boolean;
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

function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function parseLedgerIdValue(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : null;
}

function requestedLedgerId(request: FastifyRequest): number | null {
  const headerValue = request.headers["x-khata-ledger-id"];
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const fromHeader = parseLedgerIdValue(header);
  if (fromHeader !== null) return fromHeader;
  const query = request.query as { ledger_id?: unknown } | undefined;
  return parseLedgerIdValue(query?.ledger_id);
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
  return { userId, firstName, iat };
}

export function verifySession(token: string): VerifiedSession | null {
  const session = verifySessionToken(token);
  if (!session || !isConfigAllowedUser(session.userId)) return null;
  return session;
}

/** A token is revoked if it was issued before the user's revocation epoch. */
export function isSessionRevoked(iatSeconds: number, invalidBefore: Date | null): boolean {
  return invalidBefore != null && iatSeconds * 1000 < invalidBefore.getTime();
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
  if (isSessionRevoked(session.iat, access.sessionsInvalidBefore)) {
    reply.status(401).send({ error: "Session expired" });
    return null;
  }
  const ledgerAccess = await resolveLedgerForTelegramUser({
    telegramUserId: session.userId,
    requestedLedgerId: requestedLedgerId(request),
    requireWrite: isWriteMethod(request.method),
  });
  if (!ledgerAccess) {
    reply.status(403).send({ error: "Ledger access denied" });
    return null;
  }
  return {
    userId: ledgerAccess.ledgerId,
    ledgerUserId: ledgerAccess.ledgerId,
    personalLedgerId: access.ledgerUserId,
    telegramUserId: session.userId,
    actorUserId: session.userId,
    firstName: session.firstName,
    role: ledgerAccess.role,
    isOwner: ledgerAccess.canManage,
    selectedLedgerId: ledgerAccess.ledgerId,
    selectedLedgerName: ledgerAccess.ledgerName,
    selectedLedgerKind: ledgerAccess.ledgerKind,
    canView: ledgerAccess.canView,
    canAdd: ledgerAccess.canAdd,
    canManage: ledgerAccess.canManage,
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
  const ledgerAccess = await resolveLedgerForTelegramUser({
    telegramUserId: userId,
    requestedLedgerId: access.ledgerUserId,
  });
  if (!ledgerAccess) return null;
  return {
    userId: ledgerAccess.ledgerId,
    ledgerUserId: ledgerAccess.ledgerId,
    personalLedgerId: access.ledgerUserId,
    telegramUserId: userId,
    actorUserId: userId,
    firstName,
    role: ledgerAccess.role,
    isOwner: ledgerAccess.canManage,
    selectedLedgerId: ledgerAccess.ledgerId,
    selectedLedgerName: ledgerAccess.ledgerName,
    selectedLedgerKind: ledgerAccess.ledgerKind,
    canView: ledgerAccess.canView,
    canAdd: ledgerAccess.canAdd,
    canManage: ledgerAccess.canManage,
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
      personal_ledger_id: session.personalLedgerId,
      selected_ledger_id: session.selectedLedgerId,
      selected_ledger_name: session.selectedLedgerName,
      selected_ledger_kind: session.selectedLedgerKind,
      can_view: session.canView,
      can_add: session.canAdd,
      can_manage: session.canManage,
    };
  });

  app.get("/api/ledgers", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    const ledgers = await listLedgersForTelegramUser(session.telegramUserId);
    return {
      selected_ledger_id: session.selectedLedgerId,
      ledgers: ledgers.map((ledger) => ({
        id: ledger.ledgerId,
        name: ledger.ledgerName,
        kind: ledger.ledgerKind,
        owner_telegram_user_id: ledger.ownerTelegramUserId,
        role: ledger.role,
        can_view: ledger.canView,
        can_add: ledger.canAdd,
        can_manage: ledger.canManage,
      })),
    };
  });

  // POST /api/logout
  app.post("/api/logout", async (request, reply) => {
    const token = request.cookies["session"];
    if (token) {
      const session = verifySessionToken(token);
      if (session) {
        try {
          await setSessionsInvalidBefore(session.userId);
        } catch (err) {
          request.log.warn({ err }, "logout: failed to invalidate sessions");
        }
      }
    }
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
