import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getStatementDownloadUrl } from "../storage/index.js";
import { getSession } from "./auth.js";

export async function receiptsRoutes(app: FastifyInstance) {
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
