import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { sql } from "../db/index.js";
import { getStatementDownloadUrl } from "../storage/index.js";

// ─── Session helpers ─────────────────────────────────────────────────────────

function signSession(userId: number, firstName: string, iat: number): string {
  const payload = `${userId}:${Buffer.from(firstName).toString("base64url")}:${iat}`;
  const hmac = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

function verifySession(token: string): { userId: number; firstName: string } | null {
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
  return { userId, firstName };
}

async function getSession(
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

function verifyTelegramHash(data: Record<string, string>, hash: string): boolean {
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

export async function dashboardRoutes(app: FastifyInstance) {
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
    reply.setCookie("session", signSession(userId, firstName, iat), {
      httpOnly: true,
      sameSite: "none",
      secure: true,
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

  // GET /api/expenses
  app.get("/api/expenses", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const q = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(q["page"] ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q["limit"] ?? "20", 10)));
    const offset = (page - 1) * limit;

    const start = q["start"];
    const end = q["end"];
    const category = q["category"];
    const sourcePrm = q["source"];
    // map 'bot' query value to 'telegram' DB value
    const source = sourcePrm === "bot" ? "telegram" : sourcePrm;

    type ExpenseRow = {
      id: string;
      amount_cents: string;
      currency: string;
      description: string | null;
      merchant: string | null;
      category: string | null;
      source: string;
      occurred_at: Date;
      image_key: string | null;
    };

    const rows = await sql<ExpenseRow[]>`
      SELECT e.id,
             e.amount_cents::text,
             e.currency,
             e.description,
             e.merchant,
             COALESCE(c.name, 'Uncategorized') AS category,
             e.source,
             e.occurred_at,
             e.image_key
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.user_id = ${session.userId}
        ${start ? sql`AND e.occurred_at >= ${start}::date` : sql``}
        ${end ? sql`AND e.occurred_at < (${end}::date + INTERVAL '1 day')` : sql``}
        ${category ? sql`AND c.name ILIKE ${category}` : sql``}
        ${source ? sql`AND e.source = ${source}` : sql``}
      ORDER BY e.occurred_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.user_id = ${session.userId}
        ${start ? sql`AND e.occurred_at >= ${start}::date` : sql``}
        ${end ? sql`AND e.occurred_at < (${end}::date + INTERVAL '1 day')` : sql``}
        ${category ? sql`AND c.name ILIKE ${category}` : sql``}
        ${source ? sql`AND e.source = ${source}` : sql``}
    `;

    const total = parseInt(count, 10);
    return {
      data: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  });

  // GET /api/expenses/summary — MTD category totals + last 10 expenses
  app.get("/api/expenses/summary", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const now = new Date();
    const mtdStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const mtdEnd = tomorrow.toISOString().substring(0, 10);

    type CategoryTotal = {
      category: string;
      total_cents: string;
      currency: string;
      count: string;
    };
    type RecentExpense = {
      id: string;
      amount_cents: string;
      currency: string;
      description: string | null;
      merchant: string | null;
      category: string | null;
      occurred_at: Date;
    };

    const [categoryTotals, recentExpenses] = await Promise.all([
      sql<CategoryTotal[]>`
        SELECT COALESCE(c.name, 'Uncategorized') AS category,
               SUM(e.amount_cents)::text AS total_cents,
               e.currency,
               COUNT(*)::text AS count
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.user_id = ${session.userId}
          AND e.occurred_at >= ${mtdStart}::date
          AND e.occurred_at < ${mtdEnd}::date
        GROUP BY c.name, e.currency
        ORDER BY SUM(e.amount_cents) DESC
      `,
      sql<RecentExpense[]>`
        SELECT e.id,
               e.amount_cents::text,
               e.currency,
               e.description,
               e.merchant,
               COALESCE(c.name, 'Uncategorized') AS category,
               e.occurred_at
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.user_id = ${session.userId}
        ORDER BY e.occurred_at DESC
        LIMIT 10
      `,
    ]);

    return { mtd: categoryTotals, recent: recentExpenses };
  });

  // GET /api/categories
  app.get("/api/categories", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const rows = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM categories
      WHERE user_id = ${session.userId}
      ORDER BY name ASC
    `;
    return rows;
  });

  // GET /api/receipts — expenses with image_key, enriched with presigned URLs
  app.get("/api/receipts", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const q = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(q["page"] ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q["limit"] ?? "20", 10)));
    const offset = (page - 1) * limit;

    type ReceiptRow = {
      id: string;
      amount_cents: string;
      currency: string;
      description: string | null;
      merchant: string | null;
      category: string | null;
      occurred_at: Date;
      image_key: string;
    };

    const rows = await sql<ReceiptRow[]>`
      SELECT e.id,
             e.amount_cents::text,
             e.currency,
             e.description,
             e.merchant,
             COALESCE(c.name, 'Uncategorized') AS category,
             e.occurred_at,
             e.image_key
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.user_id = ${session.userId}
        AND e.image_key IS NOT NULL
      ORDER BY e.occurred_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM expenses
      WHERE user_id = ${session.userId} AND image_key IS NOT NULL
    `;

    // Enrich with presigned URLs (60-min TTL)
    const data = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        receipt_url: await getStatementDownloadUrl(row.image_key, 3600),
      })),
    );

    const total = parseInt(count, 10);
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  });
}
