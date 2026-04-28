import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getOrCreateMerchantCanonical, setMerchantCategory } from "../db/merchants.js";
import { getSession } from "./auth.js";

type ExpensesQuery = {
  page?: number;
  limit?: number;
  start?: string;
  end?: string;
  category?: string;
  source?: "bot" | "telegram" | "statement" | "receipt" | "manual";
};

type ExpenseParams = {
  id: string;
};

type ExpenseUpdateBody = {
  amount_cents?: number;
  currency?: string;
  description?: string | null;
  merchant?: string | null;
  category_id?: string | null;
  occurred_at?: string;
};

type ExpenseMergeBody = {
  duplicateId: string;
};

type ExpenseRow = {
  id: string;
  amount_cents: string;
  currency: string;
  description: string | null;
  merchant: string | null;
  merchant_canonical_id: string | null;
  category_id: string | null;
  category: string | null;
  source: string;
  occurred_at: Date;
  image_key: string | null;
};

type ExpenseInternalRow = {
  id: string;
  description: string | null;
  merchant: string | null;
  merchant_canonical_id: string | null;
  category_id: string | null;
  raw_text: string | null;
  statement_id: string | null;
  image_key: string | null;
  content_hash: string | null;
  upi_reference_id: string | null;
};

const datePattern = "^\\d{4}-\\d{2}-\\d{2}$";
const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const expensesQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    start: { type: "string", pattern: datePattern },
    end: { type: "string", pattern: datePattern },
    category: { type: "string", minLength: 1, maxLength: 100 },
    source: { type: "string", enum: ["bot", "telegram", "statement", "receipt", "manual"] },
  },
} as const;

const expenseParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

const expenseUpdateSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    amount_cents: { type: "integer", minimum: 1, maximum: 999999999999 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    description: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
    merchant: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
    category_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
    occurred_at: { type: "string", pattern: datePattern },
  },
} as const;

const expenseMergeSchema = {
  type: "object",
  required: ["duplicateId"],
  additionalProperties: false,
  properties: {
    duplicateId: { type: "string", pattern: uuidPattern },
  },
} as const;

function normalizeNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const display = value.trim().replace(/\s+/g, " ");
  return display || null;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

async function categoryBelongsToUser(userId: number, categoryId: string): Promise<boolean> {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT id FROM categories
    WHERE id = ${categoryId} AND user_id = ${userId}
    LIMIT 1
  `;
  return !!row;
}

export async function expensesRoutes(app: FastifyInstance) {
  // GET /api/expenses
  app.get<{ Querystring: ExpensesQuery }>(
    "/api/expenses",
    { schema: { querystring: expensesQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const q = request.query;
      const page = q.page ?? 1;
      const limit = q.limit ?? 20;
      const offset = (page - 1) * limit;

      const start = q["start"];
      const end = q["end"];
      const category = q["category"];
      const sourcePrm = q["source"];
      // map 'bot' query value to 'telegram' DB value
      const source = sourcePrm === "bot" ? "telegram" : sourcePrm;

      const rows = await sql<ExpenseRow[]>`
        SELECT e.id,
               e.amount_cents::text,
               e.currency,
               e.description,
               e.merchant,
               e.merchant_canonical_id,
               e.category_id,
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
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    },
  );

  // PATCH /api/expenses/:id — dashboard correction flow.
  app.patch<{ Params: ExpenseParams; Body: ExpenseUpdateBody }>(
    "/api/expenses/:id",
    { schema: { params: expenseParamsSchema, body: expenseUpdateSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const body = request.body;
      const occurredAt = body.occurred_at ? parseIsoDate(body.occurred_at) : undefined;
      if (body.occurred_at && !occurredAt) {
        return reply.status(400).send({ error: "Invalid occurred_at date" });
      }

      if (body.category_id && !(await categoryBelongsToUser(session.userId, body.category_id))) {
        return reply.status(400).send({ error: "Category not found" });
      }

      const merchant =
        body.merchant !== undefined ? normalizeNullableText(body.merchant) ?? null : undefined;
      const description =
        body.description !== undefined ? normalizeNullableText(body.description) ?? null : undefined;
      const merchantCanonicalId =
        merchant !== undefined ? await getOrCreateMerchantCanonical(session.userId, merchant) : null;
      const descriptionParam = description ?? null;
      const merchantParam = merchant ?? null;
      const categoryIdParam = body.category_id ?? null;
      const occurredAtParam = occurredAt ?? new Date(0);

      const rows = await sql<ExpenseRow[]>`
        WITH updated AS (
          UPDATE expenses
          SET amount_cents = CASE
                WHEN ${body.amount_cents !== undefined} THEN ${body.amount_cents ?? 0}
                ELSE amount_cents
              END,
              currency = CASE
                WHEN ${body.currency !== undefined} THEN ${body.currency ?? "INR"}
                ELSE currency
              END,
              description = CASE
                WHEN ${description !== undefined} THEN ${descriptionParam}
                ELSE description
              END,
              merchant = CASE
                WHEN ${merchant !== undefined} THEN ${merchantParam}
                ELSE merchant
              END,
              merchant_canonical_id = CASE
                WHEN ${merchant !== undefined} THEN ${merchantCanonicalId}
                ELSE merchant_canonical_id
              END,
              category_id = CASE
                WHEN ${body.category_id !== undefined} THEN ${categoryIdParam}
                ELSE category_id
              END,
              occurred_at = CASE
                WHEN ${occurredAt !== undefined} THEN ${occurredAtParam}
                ELSE occurred_at
              END
          WHERE id = ${request.params.id}
            AND user_id = ${session.userId}
          RETURNING id, amount_cents::text, currency, description, merchant,
                    merchant_canonical_id, category_id, source, occurred_at, image_key
        )
        SELECT updated.*,
               COALESCE(c.name, 'Uncategorized') AS category
        FROM updated
        LEFT JOIN categories c ON c.id = updated.category_id
      `;

      const updated = rows[0];
      if (!updated) return reply.status(404).send({ error: "Transaction not found" });

      if (body.category_id && updated.merchant_canonical_id) {
        await setMerchantCategory(session.userId, updated.merchant_canonical_id, body.category_id);
      }

      return updated;
    },
  );

  // DELETE /api/expenses/:id
  app.delete<{ Params: ExpenseParams }>(
    "/api/expenses/:id",
    { schema: { params: expenseParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const result = await sql<Array<{ id: string }>>`
        DELETE FROM expenses
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
        RETURNING id
      `;
      if (!result[0]) return reply.status(404).send({ error: "Transaction not found" });
      return { ok: true };
    },
  );

  // POST /api/expenses/:id/merge — keep :id, remove duplicateId, and carry over
  // missing attachment/dedup metadata from the duplicate when safe.
  app.post<{ Params: ExpenseParams; Body: ExpenseMergeBody }>(
    "/api/expenses/:id/merge",
    { schema: { params: expenseParamsSchema, body: expenseMergeSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      if (request.params.id === request.body.duplicateId) {
        return reply.status(400).send({ error: "Choose two different transactions" });
      }

      const merged = await sql.begin(async (tx) => {
        const [keeper] = await tx<ExpenseInternalRow[]>`
          SELECT id, description, merchant, merchant_canonical_id, category_id, raw_text,
                 statement_id, image_key, content_hash, upi_reference_id
          FROM expenses
          WHERE id = ${request.params.id}
            AND user_id = ${session.userId}
          FOR UPDATE
        `;
        const [duplicate] = await tx<ExpenseInternalRow[]>`
          SELECT id, description, merchant, merchant_canonical_id, category_id, raw_text,
                 statement_id, image_key, content_hash, upi_reference_id
          FROM expenses
          WHERE id = ${request.body.duplicateId}
            AND user_id = ${session.userId}
          FOR UPDATE
        `;
        if (!keeper || !duplicate) return null;

        const nextDescription = keeper.description ?? duplicate.description;
        const nextMerchant = keeper.merchant ?? duplicate.merchant;
        const nextMerchantCanonicalId =
          keeper.merchant_canonical_id ?? duplicate.merchant_canonical_id;
        const nextCategoryId = keeper.category_id ?? duplicate.category_id;
        const nextRawText = keeper.raw_text ?? duplicate.raw_text;
        const nextStatementId = keeper.statement_id ?? duplicate.statement_id;
        const nextImageKey = keeper.image_key ?? duplicate.image_key;
        const nextContentHash = keeper.content_hash ?? duplicate.content_hash;
        const nextUpiReferenceId = keeper.upi_reference_id ?? duplicate.upi_reference_id;

        await tx`
          DELETE FROM expenses
          WHERE id = ${duplicate.id}
            AND user_id = ${session.userId}
        `;

        const rows = await tx<ExpenseRow[]>`
          WITH updated AS (
            UPDATE expenses
            SET description = ${nextDescription},
                merchant = ${nextMerchant},
                merchant_canonical_id = ${nextMerchantCanonicalId},
                category_id = ${nextCategoryId},
                raw_text = ${nextRawText},
                statement_id = ${nextStatementId},
                image_key = ${nextImageKey},
                content_hash = ${nextContentHash},
                upi_reference_id = ${nextUpiReferenceId}
            WHERE id = ${keeper.id}
              AND user_id = ${session.userId}
            RETURNING id, amount_cents::text, currency, description, merchant,
                      merchant_canonical_id, category_id, source, occurred_at, image_key
          )
          SELECT updated.*,
                 COALESCE(c.name, 'Uncategorized') AS category
          FROM updated
          LEFT JOIN categories c ON c.id = updated.category_id
        `;
        return rows[0] ?? null;
      });

      if (!merged) return reply.status(404).send({ error: "Transaction not found" });
      return { ok: true, expense: merged };
    },
  );

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
