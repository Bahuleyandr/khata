import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getObjectStream } from "../storage/index.js";
import { getSession } from "./auth.js";

export async function receiptsRoutes(app: FastifyInstance) {
  // GET /api/receipts — list of receipt expenses with proxy URLs
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

    // receipt_url is a same-origin proxy path the browser hits with its
    // session cookie. Backend streams the bytes from in-cluster MinIO.
    const data = rows.map((row) => ({
      ...row,
      receipt_url: `/api/receipts/${row.id}/image`,
    }));

    const total = parseInt(count, 10);
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  });

  // GET /api/receipts/:id/image — stream a receipt image from MinIO,
  // gated by session ownership of the expense row.
  app.get<{ Params: { id: string } }>(
    "/api/receipts/:id/image",
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const [row] = await sql<[{ image_key: string | null }] | []>`
        SELECT image_key FROM expenses
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
          AND image_key IS NOT NULL
        LIMIT 1
      `;
      if (!row?.image_key) {
        reply.status(404);
        return { error: "Not found" };
      }

      const { body, contentType } = await getObjectStream(row.image_key);
      reply.header("Content-Type", contentType ?? "application/octet-stream");
      reply.header("Cache-Control", "private, max-age=300");
      return reply.send(body);
    },
  );
}
