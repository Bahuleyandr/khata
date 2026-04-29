import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "../db/index.js";
import { recordAuditEvent } from "../db/audit.js";
import { getBudgetsWithMtd } from "../db/budgets.js";
import { findSubscriptionCandidates } from "../db/query.js";
import { getOrCreateMerchantCanonical, setMerchantCategory } from "../db/merchants.js";
import { attachTagToExpense, getOrCreateTag, getTagsForExpenses } from "../db/tags.js";
import { currentMonthBounds } from "../export/xlsx.js";
import { uploadStatement } from "../storage/index.js";
import { getSession } from "./auth.js";

type ExpensesQuery = {
  page?: number;
  limit?: number;
  start?: string;
  end?: string;
  category?: string;
  source?: "bot" | "telegram" | "statement" | "receipt" | "manual";
  merchant?: string;
  min_amount_cents?: number;
  max_amount_cents?: number;
  tag?: string;
  uncategorized?: boolean;
  has_receipt?: boolean;
  review_status?: "needs_review" | "reviewed" | "ignored";
  duplicates?: boolean;
};

type SummaryQuery = {
  year?: number;
  month?: number;
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
  review_status?: "needs_review" | "reviewed" | "ignored";
};

type ExpenseCreateBody = {
  amount_cents: number;
  currency?: string;
  description?: string | null;
  merchant?: string | null;
  category_id?: string | null;
  occurred_at: string;
  review_status?: "needs_review" | "reviewed" | "ignored";
  tag_names?: string[];
};

type ExpenseMergeBody = {
  duplicateId: string;
};

type ExpenseBulkBody = {
  ids: string[];
  category_id?: string | null;
  tag_names?: string[];
  review_status?: "needs_review" | "reviewed" | "ignored";
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
  review_status: string;
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
    merchant: { type: "string", minLength: 1, maxLength: 160 },
    min_amount_cents: { type: "integer", minimum: 0 },
    max_amount_cents: { type: "integer", minimum: 0 },
    tag: { type: "string", minLength: 1, maxLength: 80 },
    uncategorized: { type: "boolean" },
    has_receipt: { type: "boolean" },
    review_status: { type: "string", enum: ["needs_review", "reviewed", "ignored"] },
    duplicates: { type: "boolean" },
  },
} as const;

const summaryQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
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
    review_status: { type: "string", enum: ["needs_review", "reviewed", "ignored"] },
  },
} as const;

const expenseCreateSchema = {
  type: "object",
  required: ["amount_cents", "occurred_at"],
  additionalProperties: false,
  properties: {
    amount_cents: { type: "integer", minimum: 1, maximum: 999999999999 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    description: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
    merchant: { anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }] },
    category_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
    occurred_at: { type: "string", pattern: datePattern },
    review_status: { type: "string", enum: ["needs_review", "reviewed", "ignored"] },
    tag_names: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
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

const expenseBulkSchema = {
  type: "object",
  required: ["ids"],
  additionalProperties: false,
  properties: {
    ids: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: "string", pattern: uuidPattern },
    },
    category_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
    tag_names: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
    review_status: { type: "string", enum: ["needs_review", "reviewed", "ignored"] },
  },
} as const;

const MAX_RECEIPT_UPLOAD_BYTES = 5 * 1024 * 1024;

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

async function addTagsToExpenses(userId: number, expenseIds: string[], tagNames: string[] = []) {
  const names = tagNames.map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    const tagId = await getOrCreateTag(userId, name);
    if (!tagId) continue;
    for (const expenseId of expenseIds) {
      await attachTagToExpense(expenseId, tagId);
    }
  }
}

function selectedMonth(query: SummaryQuery): { year: number; month: number } {
  const now = new Date();
  return {
    year: query.year ?? now.getFullYear(),
    month: query.month ?? now.getMonth() + 1,
  };
}

function monthProgress(year: number, month: number): { elapsedDays: number; daysInMonth: number } {
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  return {
    elapsedDays: isCurrentMonth ? Math.max(1, Math.min(now.getDate(), daysInMonth)) : daysInMonth,
    daysInMonth,
  };
}

function monthlyNarrative(input: {
  label: string;
  totalCents: number;
  transactionCount: number;
  topCategory: string | null;
  topMerchant: string | null;
  overBudgetCount: number;
  uncategorizedCount: number;
}): string {
  const rupees = Math.round(input.totalCents / 100).toLocaleString("en-IN");
  const parts = [
    `${input.label}: ₹${rupees} across ${input.transactionCount} transaction${input.transactionCount === 1 ? "" : "s"}.`,
  ];
  if (input.topCategory) parts.push(`Top category is ${input.topCategory}.`);
  if (input.topMerchant) parts.push(`Top merchant is ${input.topMerchant}.`);
  if (input.overBudgetCount > 0) {
    parts.push(`${input.overBudgetCount} budget${input.overBudgetCount === 1 ? "" : "s"} projected over target.`);
  }
  if (input.uncategorizedCount > 0) {
    parts.push(`${input.uncategorizedCount} item${input.uncategorizedCount === 1 ? "" : "s"} need categorizing.`);
  }
  return parts.join(" ");
}

async function withTags<T extends { id: string }>(rows: T[]): Promise<Array<T & { tags: string[] }>> {
  const tagsByExpense = await getTagsForExpenses(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, tags: tagsByExpense.get(row.id) ?? [] }));
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
      const merchantSearch = q["merchant"] ? `%${q["merchant"].trim()}%` : null;
      const tag = q["tag"];
      const duplicatePredicate = sql`
        EXISTS (
          SELECT 1
          FROM expenses d
          WHERE d.user_id = e.user_id
            AND d.id <> e.id
            AND d.amount_cents = e.amount_cents
            AND ABS(EXTRACT(EPOCH FROM (d.occurred_at - e.occurred_at))) <= 172800
            AND lower(COALESCE(d.merchant, d.description, '')) =
                lower(COALESCE(e.merchant, e.description, ''))
        )
      `;

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
               e.image_key,
               e.review_status
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.user_id = ${session.userId}
          ${start ? sql`AND e.occurred_at >= ${start}::date` : sql``}
          ${end ? sql`AND e.occurred_at < (${end}::date + INTERVAL '1 day')` : sql``}
          ${category ? sql`AND c.name ILIKE ${category}` : sql``}
          ${source ? sql`AND e.source = ${source}` : sql``}
          ${merchantSearch ? sql`AND (e.merchant ILIKE ${merchantSearch} OR e.description ILIKE ${merchantSearch})` : sql``}
          ${q.min_amount_cents !== undefined ? sql`AND e.amount_cents >= ${q.min_amount_cents}` : sql``}
          ${q.max_amount_cents !== undefined ? sql`AND e.amount_cents <= ${q.max_amount_cents}` : sql``}
          ${tag ? sql`AND EXISTS (
            SELECT 1 FROM expense_tags et
            JOIN tags t ON t.id = et.tag_id
            WHERE et.expense_id = e.id
              AND t.user_id = ${session.userId}
              AND lower(t.name) = lower(${tag})
          )` : sql``}
          ${q.uncategorized === true ? sql`AND e.category_id IS NULL` : sql``}
          ${q.has_receipt === true ? sql`AND e.image_key IS NOT NULL` : sql``}
          ${q.has_receipt === false ? sql`AND e.image_key IS NULL` : sql``}
          ${q.review_status ? sql`AND e.review_status = ${q.review_status}` : sql``}
          ${q.duplicates === true ? sql`AND ${duplicatePredicate}` : sql``}
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
          ${merchantSearch ? sql`AND (e.merchant ILIKE ${merchantSearch} OR e.description ILIKE ${merchantSearch})` : sql``}
          ${q.min_amount_cents !== undefined ? sql`AND e.amount_cents >= ${q.min_amount_cents}` : sql``}
          ${q.max_amount_cents !== undefined ? sql`AND e.amount_cents <= ${q.max_amount_cents}` : sql``}
          ${tag ? sql`AND EXISTS (
            SELECT 1 FROM expense_tags et
            JOIN tags t ON t.id = et.tag_id
            WHERE et.expense_id = e.id
              AND t.user_id = ${session.userId}
              AND lower(t.name) = lower(${tag})
          )` : sql``}
          ${q.uncategorized === true ? sql`AND e.category_id IS NULL` : sql``}
          ${q.has_receipt === true ? sql`AND e.image_key IS NOT NULL` : sql``}
          ${q.has_receipt === false ? sql`AND e.image_key IS NULL` : sql``}
          ${q.review_status ? sql`AND e.review_status = ${q.review_status}` : sql``}
          ${q.duplicates === true ? sql`AND ${duplicatePredicate}` : sql``}
      `;

      const total = parseInt(count, 10);
      return {
        data: await withTags(rows),
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    },
  );

  // POST /api/expenses — manual dashboard entry for cash/card items missed by capture.
  app.post<{ Body: ExpenseCreateBody }>(
    "/api/expenses",
    { schema: { body: expenseCreateSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const body = request.body;
      const occurredAt = parseIsoDate(body.occurred_at);
      if (!occurredAt) return reply.status(400).send({ error: "Invalid occurred_at date" });

      if (body.category_id && !(await categoryBelongsToUser(session.userId, body.category_id))) {
        return reply.status(400).send({ error: "Category not found" });
      }

      const merchant = normalizeNullableText(body.merchant) ?? null;
      const description = normalizeNullableText(body.description) ?? null;
      if (!merchant && !description) {
        return reply.status(400).send({ error: "Merchant or description is required" });
      }

      const merchantCanonicalId = merchant
        ? await getOrCreateMerchantCanonical(session.userId, merchant)
        : null;
      const reviewStatus = body.review_status ?? "reviewed";

      const rows = await sql<ExpenseRow[]>`
        WITH inserted AS (
          INSERT INTO expenses (
            user_id,
            amount_cents,
            currency,
            description,
            merchant,
            merchant_canonical_id,
            category_id,
            occurred_at,
            source,
            raw_text,
            review_status,
            reviewed_at
          )
          VALUES (
            ${session.userId},
            ${body.amount_cents},
            ${body.currency ?? "INR"},
            ${description},
            ${merchant},
            ${merchantCanonicalId},
            ${body.category_id ?? null},
            ${occurredAt},
            'manual',
            NULL,
            ${reviewStatus},
            CASE WHEN ${reviewStatus} = 'reviewed' THEN NOW() ELSE NULL END
          )
          RETURNING id, amount_cents::text, currency, description, merchant,
                    merchant_canonical_id, category_id, source, occurred_at, image_key,
                    review_status
        )
        SELECT inserted.*,
               COALESCE(c.name, 'Uncategorized') AS category
        FROM inserted
        LEFT JOIN categories c ON c.id = inserted.category_id
      `;

      const created = rows[0];
      if (!created) return reply.status(500).send({ error: "Failed to create transaction" });

      if (body.category_id && merchantCanonicalId) {
        await setMerchantCategory(session.userId, merchantCanonicalId, body.category_id);
      }

      await addTagsToExpenses(session.userId, [created.id], body.tag_names);
      const [createdWithTags] = await withTags([created]);
      await recordAuditEvent({
        userId: session.userId,
        action: "expense.create",
        entityType: "expense",
        entityId: created.id,
        after: createdWithTags,
        metadata: { source: "manual", tag_names: body.tag_names ?? [] },
      });

      return reply.status(201).send(createdWithTags);
    },
  );

  // POST /api/expenses/bulk — bulk dashboard correction.
  app.post<{ Body: ExpenseBulkBody }>(
    "/api/expenses/bulk",
    { schema: { body: expenseBulkSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const body = request.body;
      if (body.category_id && !(await categoryBelongsToUser(session.userId, body.category_id))) {
        return reply.status(400).send({ error: "Category not found" });
      }

      const updated = await sql<Array<{ id: string }>>`
        UPDATE expenses
        SET category_id = CASE
              WHEN ${body.category_id !== undefined} THEN ${body.category_id ?? null}
              ELSE category_id
            END,
            review_status = CASE
              WHEN ${body.review_status !== undefined} THEN ${body.review_status ?? "reviewed"}
              ELSE review_status
            END,
            reviewed_at = CASE
              WHEN ${body.review_status === "reviewed"} THEN NOW()
              WHEN ${body.review_status !== undefined} THEN NULL
              ELSE reviewed_at
            END
        WHERE user_id = ${session.userId}
          AND id = ANY(${body.ids}::uuid[])
        RETURNING id
      `;
      await addTagsToExpenses(session.userId, updated.map((row) => row.id), body.tag_names);
      await recordAuditEvent({
        userId: session.userId,
        action: "expense.bulk_update",
        entityType: "expense",
        metadata: {
          requested_ids: body.ids,
          updated_ids: updated.map((row) => row.id),
          category_id: body.category_id,
          tag_names: body.tag_names ?? [],
          review_status: body.review_status,
        },
      });
      return { ok: true, updated: updated.length };
    },
  );

  // GET /api/expenses/:id/duplicates — likely duplicate candidates for merge UX.
  app.get<{ Params: ExpenseParams }>(
    "/api/expenses/:id/duplicates",
    { schema: { params: expenseParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const [target] = await sql<Array<{
        id: string;
        amount_cents: string;
        merchant: string | null;
        description: string | null;
        occurred_at: Date;
      }>>`
        SELECT id, amount_cents::text, merchant, description, occurred_at
        FROM expenses
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
        LIMIT 1
      `;
      if (!target) return reply.status(404).send({ error: "Transaction not found" });

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
               e.image_key,
               e.review_status
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.user_id = ${session.userId}
          AND e.id <> ${target.id}
          AND e.amount_cents = ${target.amount_cents}
          AND ABS(EXTRACT(EPOCH FROM (e.occurred_at - ${target.occurred_at}))) <= 172800
          AND lower(COALESCE(e.merchant, e.description, '')) =
              lower(COALESCE(${target.merchant}, ${target.description}, ''))
        ORDER BY ABS(EXTRACT(EPOCH FROM (e.occurred_at - ${target.occurred_at}))) ASC,
                 e.created_at DESC
        LIMIT 10
      `;
      return { candidates: await withTags(rows) };
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

      const [before] = await sql<ExpenseRow[]>`
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
               e.image_key,
               e.review_status
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.id = ${request.params.id}
          AND e.user_id = ${session.userId}
        LIMIT 1
      `;
      if (!before) return reply.status(404).send({ error: "Transaction not found" });

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
      const reviewStatusParam = body.review_status ?? "reviewed";

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
              END,
              review_status = CASE
                WHEN ${body.review_status !== undefined} THEN ${reviewStatusParam}
                ELSE review_status
              END,
              reviewed_at = CASE
                WHEN ${body.review_status === "reviewed"} THEN NOW()
                WHEN ${body.review_status !== undefined} THEN NULL
                ELSE reviewed_at
              END
          WHERE id = ${request.params.id}
            AND user_id = ${session.userId}
          RETURNING id, amount_cents::text, currency, description, merchant,
                    merchant_canonical_id, category_id, source, occurred_at, image_key,
                    review_status
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

      await recordAuditEvent({
        userId: session.userId,
        action: "expense.update",
        entityType: "expense",
        entityId: updated.id,
        before,
        after: updated,
      });

      return updated;
    },
  );

  // POST /api/expenses/:id/receipt — attach or replace a receipt image manually.
  app.post<{ Params: ExpenseParams }>(
    "/api/expenses/:id/receipt",
    { schema: { params: expenseParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const file = await request.file({ limits: { fileSize: MAX_RECEIPT_UPLOAD_BYTES } });
      if (!file) return reply.status(400).send({ error: "Receipt file is required" });
      const supported = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      const mimeType = supported.includes(file.mimetype) ? file.mimetype : "image/jpeg";
      const buffer = await file.toBuffer();
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const imageKey = `receipts/${session.userId}/${randomUUID()}`;
      await uploadStatement(imageKey, buffer, mimeType);

      const rows = await sql<ExpenseRow[]>`
        WITH updated AS (
          UPDATE expenses
          SET image_key = ${imageKey},
              content_hash = ${contentHash},
              review_status = 'needs_review',
              reviewed_at = NULL
          WHERE id = ${request.params.id}
            AND user_id = ${session.userId}
          RETURNING id, amount_cents::text, currency, description, merchant,
                    merchant_canonical_id, category_id, source, occurred_at, image_key,
                    review_status
        )
        SELECT updated.*,
               COALESCE(c.name, 'Uncategorized') AS category
        FROM updated
        LEFT JOIN categories c ON c.id = updated.category_id
      `;

      const updated = rows[0];
      if (!updated) return reply.status(404).send({ error: "Transaction not found" });
      const [updatedWithTags] = await withTags([updated]);
      await recordAuditEvent({
        userId: session.userId,
        action: "expense.receipt_attach",
        entityType: "expense",
        entityId: updated.id,
        after: updatedWithTags,
        metadata: { image_key: imageKey, content_hash: contentHash },
      });
      return updatedWithTags;
    },
  );

  // DELETE /api/expenses/:id
  app.delete<{ Params: ExpenseParams }>(
    "/api/expenses/:id",
    { schema: { params: expenseParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const result = await sql<Array<{
        id: string;
        amount_cents: string;
        currency: string;
        description: string | null;
        merchant: string | null;
        merchant_canonical_id: string | null;
        category_id: string | null;
        source: string;
        occurred_at: Date;
        image_key: string | null;
        review_status: string;
      }>>`
        DELETE FROM expenses
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
        RETURNING id, amount_cents::text, currency, description, merchant,
                  merchant_canonical_id, category_id, source, occurred_at, image_key,
                  review_status
      `;
      if (!result[0]) return reply.status(404).send({ error: "Transaction not found" });
      await recordAuditEvent({
        userId: session.userId,
        action: "expense.delete",
        entityType: "expense",
        entityId: result[0].id,
        before: result[0],
      });
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

      const mergeResult = await sql.begin(async (tx) => {
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
                      merchant_canonical_id, category_id, source, occurred_at, image_key,
                      review_status
          )
          SELECT updated.*,
                 COALESCE(c.name, 'Uncategorized') AS category
          FROM updated
          LEFT JOIN categories c ON c.id = updated.category_id
        `;
        return { merged: rows[0] ?? null, keeper, duplicate };
      });

      if (!mergeResult?.merged) return reply.status(404).send({ error: "Transaction not found" });
      await recordAuditEvent({
        userId: session.userId,
        action: "expense.merge",
        entityType: "expense",
        entityId: mergeResult.merged.id,
        before: {
          keeper: mergeResult.keeper,
          duplicate: mergeResult.duplicate,
        },
        after: mergeResult.merged,
        metadata: { duplicate_id: request.body.duplicateId },
      });
      return { ok: true, expense: mergeResult.merged };
    },
  );

  // GET /api/expenses/summary — selected-month category totals, recent rows, budgets, trends.
  app.get<{ Querystring: SummaryQuery }>(
    "/api/expenses/summary",
    { schema: { querystring: summaryQuerySchema } },
    async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const { year, month } = selectedMonth(request.query);
    const bounds = currentMonthBounds(year, month);
    const { elapsedDays, daysInMonth } = monthProgress(year, month);

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
    type MerchantTrend = {
      name: string;
      total_cents: string;
      count: number;
    };
    type SpikeRow = MerchantTrend & {
      previous_avg_cents: string;
    };

    const [categoryTotals, recentExpenses, topMerchants, newMerchants, spikes, budgets, subscriptions] = await Promise.all([
      sql<CategoryTotal[]>`
        SELECT COALESCE(c.name, 'Uncategorized') AS category,
               SUM(e.amount_cents)::text AS total_cents,
               e.currency,
               COUNT(*)::text AS count
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.user_id = ${session.userId}
          AND e.occurred_at >= ${bounds.start}::date
          AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
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
          AND e.occurred_at >= ${bounds.start}::date
          AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        ORDER BY e.occurred_at DESC
        LIMIT 10
      `,
      sql<MerchantTrend[]>`
        SELECT COALESCE(mc.name, e.merchant, e.description, 'Unknown') AS name,
               SUM(e.amount_cents)::text AS total_cents,
               COUNT(*)::int AS count
        FROM expenses e
        LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
        WHERE e.user_id = ${session.userId}
          AND e.occurred_at >= ${bounds.start}::date
          AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
        GROUP BY COALESCE(mc.name, e.merchant, e.description, 'Unknown')
        ORDER BY SUM(e.amount_cents) DESC
        LIMIT 5
      `,
      sql<MerchantTrend[]>`
        SELECT COALESCE(mc.name, e.merchant, e.description, 'Unknown') AS name,
               SUM(e.amount_cents)::text AS total_cents,
               COUNT(*)::int AS count
        FROM expenses e
        LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
        WHERE e.user_id = ${session.userId}
          AND e.occurred_at >= ${bounds.start}::date
          AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM expenses older
            LEFT JOIN merchants_canonical older_mc ON older_mc.id = older.merchant_canonical_id
            WHERE older.user_id = e.user_id
              AND older.occurred_at < ${bounds.start}::date
              AND lower(COALESCE(older_mc.name, older.merchant, older.description, '')) =
                  lower(COALESCE(mc.name, e.merchant, e.description, ''))
          )
        GROUP BY COALESCE(mc.name, e.merchant, e.description, 'Unknown')
        ORDER BY SUM(e.amount_cents) DESC
        LIMIT 5
      `,
      sql<SpikeRow[]>`
        WITH current_month AS (
          SELECT lower(COALESCE(mc.name, e.merchant, e.description, 'Unknown')) AS key,
                 COALESCE(mc.name, e.merchant, e.description, 'Unknown') AS name,
                 SUM(e.amount_cents) AS total_cents,
                 COUNT(*)::int AS count
          FROM expenses e
          LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
          WHERE e.user_id = ${session.userId}
            AND e.occurred_at >= ${bounds.start}::date
            AND e.occurred_at < (${bounds.end}::date + INTERVAL '1 day')
          GROUP BY
            lower(COALESCE(mc.name, e.merchant, e.description, 'Unknown')),
            COALESCE(mc.name, e.merchant, e.description, 'Unknown')
        ),
        previous_three AS (
          SELECT lower(COALESCE(mc.name, e.merchant, e.description, 'Unknown')) AS key,
                 SUM(e.amount_cents) / 3.0 AS avg_cents
          FROM expenses e
          LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
          WHERE e.user_id = ${session.userId}
            AND e.occurred_at >= (${bounds.start}::date - INTERVAL '3 months')
            AND e.occurred_at < ${bounds.start}::date
          GROUP BY lower(COALESCE(mc.name, e.merchant, e.description, 'Unknown'))
        )
        SELECT c.name,
               c.total_cents::text,
               c.count,
               COALESCE(p.avg_cents, 0)::bigint::text AS previous_avg_cents
        FROM current_month c
        LEFT JOIN previous_three p ON p.key = c.key
        WHERE c.total_cents > 0
          AND (p.avg_cents IS NULL OR c.total_cents >= p.avg_cents * 2)
        ORDER BY c.total_cents DESC
        LIMIT 5
      `,
      getBudgetsWithMtd(session.userId, bounds.rangeKey),
      findSubscriptionCandidates(session.userId, 6, 2),
    ]);

    const totalCents = categoryTotals.reduce((sum, row) => sum + Number(row.total_cents), 0);
    const transactionCount = categoryTotals.reduce((sum, row) => sum + Number(row.count), 0);
    const budget_variance = budgets.map((budget) => {
      const daily = elapsedDays > 0 ? budget.spent_cents / elapsedDays : 0;
      const projected_cents = Math.round(daily * daysInMonth);
      return {
        ...budget,
        projected_cents,
        variance_cents: budget.spent_cents - budget.target_cents,
        projected_variance_cents: projected_cents - budget.target_cents,
      };
    });
    const uncategorized = categoryTotals.find((row) => row.category === "Uncategorized");
    const narrative = monthlyNarrative({
      label: bounds.label,
      totalCents,
      transactionCount,
      topCategory: categoryTotals[0]?.category ?? null,
      topMerchant: topMerchants[0]?.name ?? null,
      overBudgetCount: budget_variance.filter((budget) => budget.projected_variance_cents > 0).length,
      uncategorizedCount: uncategorized ? Number(uncategorized.count) : 0,
    });

    return {
      period: {
        year,
        month,
        label: bounds.label,
        start: bounds.start,
        end: bounds.end,
        rangeKey: bounds.rangeKey,
        elapsedDays,
        daysInMonth,
      },
      mtd: categoryTotals,
      recent: recentExpenses,
      budgets: budget_variance,
      merchants: {
        top: topMerchants,
        new: newMerchants,
        spikes,
      },
      subscriptions: subscriptions.map((subscription) => ({
        name: subscription.merchant,
        merchant_key: subscription.merchant_key,
        count: subscription.count,
        total_cents: subscription.total_cents,
        first_seen: subscription.first_seen,
        last_seen: subscription.last_seen,
        cadence: subscription.cadence,
        confidence: subscription.confidence,
        avg_amount_cents: subscription.avg_amount_cents,
        monthly_estimate_cents: subscription.monthly_estimate_cents,
        avg_interval_days: subscription.avg_interval_days,
        interval_jitter_days: subscription.interval_jitter_days,
        amount_variance_pct: subscription.amount_variance_pct,
        charge_dates: subscription.charge_dates,
        next_expected_at: subscription.next_expected_at,
        days_until_next: subscription.days_until_next,
        is_overdue: subscription.is_overdue,
        not_seen_this_month: subscription.not_seen_this_month,
        preference_status: subscription.preference_status,
      })),
      narrative,
    };
    },
  );

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
