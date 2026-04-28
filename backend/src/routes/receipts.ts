import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getObjectStream } from "../storage/index.js";
import { getSession } from "./auth.js";

type ReceiptsQuery = {
  page?: number;
  limit?: number;
  start?: string;
  end?: string;
  review_status?: "needs_review" | "reviewed" | "ignored";
};

const datePattern = "^\\d{4}-\\d{2}-\\d{2}$";

const receiptsQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    start: { type: "string", pattern: datePattern },
    end: { type: "string", pattern: datePattern },
    review_status: { type: "string", enum: ["needs_review", "reviewed", "ignored"] },
  },
} as const;

const receiptParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
  },
} as const;

export async function receiptsRoutes(app: FastifyInstance) {
  // GET /api/receipts — list of receipt expenses with proxy URLs
  app.get<{ Querystring: ReceiptsQuery }>(
    "/api/receipts",
    { schema: { querystring: receiptsQuerySchema } },
    async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const q = request.query;
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const offset = (page - 1) * limit;
    const start = q.start ?? null;
    const end = q.end ?? null;
    const reviewStatus = q.review_status ?? null;

    type ReceiptRow = {
      id: string;
      amount_cents: string;
      currency: string;
      description: string | null;
      merchant: string | null;
      category_id: string | null;
      category: string | null;
      occurred_at: Date;
      image_key: string;
      raw_text: string | null;
      review_status: string;
    };

    const rows = await sql<ReceiptRow[]>`
      SELECT e.id,
             e.amount_cents::text,
             e.currency,
             e.description,
             e.merchant,
             e.category_id,
             COALESCE(c.name, 'Uncategorized') AS category,
             e.occurred_at,
             e.image_key,
             e.raw_text,
             e.review_status
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.user_id = ${session.userId}
        AND e.image_key IS NOT NULL
        AND (${start}::date IS NULL OR e.occurred_at >= ${start}::date)
        AND (${end}::date IS NULL OR e.occurred_at < (${end}::date + INTERVAL '1 day'))
        AND (${reviewStatus}::text IS NULL OR e.review_status = ${reviewStatus})
      ORDER BY e.occurred_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM expenses
      WHERE user_id = ${session.userId}
        AND image_key IS NOT NULL
        AND (${start}::date IS NULL OR occurred_at >= ${start}::date)
        AND (${end}::date IS NULL OR occurred_at < (${end}::date + INTERVAL '1 day'))
        AND (${reviewStatus}::text IS NULL OR review_status = ${reviewStatus})
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
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
    },
  );

  // GET /api/receipts/:id/image — stream a receipt image from MinIO,
  // gated by session ownership of the expense row.
  app.get<{ Params: { id: string } }>(
    "/api/receipts/:id/image",
    { schema: { params: receiptParamsSchema } },
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
