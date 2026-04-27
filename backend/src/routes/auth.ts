import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

// ─── Session helpers ─────────────────────────────────────────────────────────

export function signSession(userId: number, firstName: string, iat: number): string {
  const payload = `${userId}:${Buffer.from(firstName).toString("base64url")}:${iat}`;
  const hmac = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

const SESSION_MAX_AGE_S = 604800;

export function verifySession(token: string): { userId: number; firstName: string } | null {
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
  if (isNaN(iat) || Math.floor(Date.now() / 1000) - iat > SESSION_MAX_AGE_S) return null;
  return { userId, firstName };
}

export async function getSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ userId: number; firstName: string } | null> {
  const token = request.cookies["session"];
  if (!token) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
  const session = verifySession(token);
  if (!session) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
  return session;
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
  app.post("/api/auth/telegram", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const { hash, ...data } = body;
    if (!hash) return reply.status(400).send({ error: "Missing hash" });

    const authDate = parseInt(data["auth_date"] ?? "0", 10);
    if (Math.floor(Date.now() / 1000) - authDate > 300) {
      return reply.status(401).send({ error: "Auth token expired" });
    }

    if (!verifyTelegramHash(data, hash)) {
      return reply.status(401).send({ error: "Invalid hash" });
    }

    const userId = parseInt(data["id"] ?? "", 10);
    if (!config.allowedTelegramUserIds.includes(userId)) {
      return reply.status(403).send({ error: "User not allowed" });
    }

    const firstName = data["first_name"] ?? "";
    const iat = Math.floor(Date.now() / 1000);
    const isProd = process.env.NODE_ENV === "production";
    reply.setCookie("session", signSession(userId, firstName, iat), {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      maxAge: 604800,
      path: "/",
    });

    return { ok: true };
  });

  // GET /api/me
  app.get("/api/me", async (request, reply) => {
    const token = request.cookies["session"];
    if (!token) return reply.status(401).send({ error: "Unauthorized" });
    const session = verifySession(token);
    if (!session) return reply.status(401).send({ error: "Unauthorized" });
    return { telegram_user_id: session.userId, first_name: session.firstName };
  });
}
