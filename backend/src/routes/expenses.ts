import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getSession } from "./auth.js";

export async function expensesRoutes(app: FastifyInstance) {
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
}
