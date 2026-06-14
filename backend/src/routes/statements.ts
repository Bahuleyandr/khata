import type { FastifyInstance } from "fastify";
import { accountBelongsToUser, guessAccountFromText } from "../db/accounts.js";
import { sql } from "../db/index.js";
import { recordAuditEvent } from "../db/audit.js";
import { applySmartRules } from "../db/smart-rules.js";
import { suggestionPatternFromText, upsertRuleSuggestion } from "../db/rule-suggestions.js";
import { buildCaptureConfidence } from "../capture/confidence.js";
import { getObjectStream, uploadStatement } from "../storage/index.js";
import { parseStatementBuffer } from "../statement/parser.js";
import { dedupeTransactions } from "../statement/dedup.js";
import { createStatementRecord, updateStatementStatus } from "../statement/importer.js";
import type { DedupeResult } from "../statement/types.js";
import { redactError } from "../statement/redact.js";
import { getSession } from "./auth.js";
import { statementLimiter } from "../lib/rate-limit.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const statementParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

const statementRowParamsSchema = {
  type: "object",
  required: ["id", "rowId"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
    rowId: { type: "string", pattern: uuidPattern },
  },
} as const;

const importRowsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    row_ids: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", pattern: uuidPattern },
    },
  },
} as const;

const updateStatementRowSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["pending", "ignored"] },
    category_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
    account_id: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
    tag_names: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
  },
} as const;

const statementUploadQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    account_id: { type: "string", pattern: uuidPattern },
  },
} as const;

type StatementRow = {
  id: string;
  file_key: string;
  mime_type: string | null;
  status: string;
  parsed_count: number;
  imported_count: number;
  duplicate_count: number;
  error_reason: string | null;
  account_id: string | null;
  account: string | null;
  created_at: Date;
  updated_at: Date;
};

type StatementImportRow = {
  id: string;
  statement_id: string;
  row_index: number;
  occurred_at: string;
  description: string;
  amount_cents: string;
  currency: string;
  suggested_category: string | null;
  category_id: string | null;
  category: string | null;
  account_id: string | null;
  account: string | null;
  tag_names: string[];
  already_logged: boolean;
  matched_expense_id: string | null;
  status: "pending" | "imported" | "ignored" | "duplicate";
  imported_expense_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type StatementRowUpdateBody = {
  status?: "pending" | "ignored";
  category_id?: string | null;
  account_id?: string | null;
  tag_names?: string[];
};

const MAX_STATEMENT_UPLOAD_BYTES = 5 * 1024 * 1024;
const statementMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function normalizeStatementMime(mimetype: string, filename?: string): string | null {
  if (statementMimeTypes.has(mimetype)) return mimetype;
  const lower = filename?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return null;
}

function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTagNames(rawNames: string[]): string[] {
  const names = rawNames.map(normalizeTagName).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 20);
}

async function categoryBelongsToUser(userId: number, categoryId: string): Promise<boolean> {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT id FROM categories
    WHERE id = ${categoryId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return !!row;
}

async function getStatementById(userId: number, statementId: string): Promise<StatementRow | null> {
  const [statement] = await sql<StatementRow[]>`
    SELECT s.id, s.file_key, s.mime_type, s.status, s.parsed_count, s.imported_count,
           s.duplicate_count, s.error_reason, s.account_id::text AS account_id,
           a.name AS account, s.created_at, s.updated_at
    FROM statements s
    LEFT JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
    WHERE s.id = ${statementId}
      AND s.user_id = ${userId}
    LIMIT 1
  `;
  return statement ?? null;
}

async function listStatementRows(userId: number, statementId: string): Promise<StatementImportRow[]> {
  return sql<StatementImportRow[]>`
    SELECT r.id,
           r.statement_id::text AS statement_id,
           r.row_index,
           r.occurred_at::date::text AS occurred_at,
           r.description,
           r.amount_cents::text AS amount_cents,
           r.currency,
           r.suggested_category,
           r.category_id::text AS category_id,
           c.name AS category,
           r.account_id::text AS account_id,
           a.name AS account,
           r.tag_names,
           r.already_logged,
           r.matched_expense_id::text AS matched_expense_id,
           r.status,
           r.imported_expense_id::text AS imported_expense_id,
           r.created_at,
           r.updated_at
    FROM statement_import_rows r
    LEFT JOIN categories c ON c.id = r.category_id AND c.user_id = ${userId}
    LEFT JOIN accounts a ON a.id = r.account_id AND a.user_id = ${userId}
    WHERE r.user_id = ${userId}
      AND r.statement_id = ${statementId}
    ORDER BY r.row_index ASC
  `;
}

async function replaceStatementRows(
  userId: number,
  statementId: string,
  results: DedupeResult[],
  accountId: string | null,
): Promise<void> {
  await sql`
    DELETE FROM statement_import_rows
    WHERE user_id = ${userId}
      AND statement_id = ${statementId}
  `;

  if (results.length === 0) return;

  const payload = [];
  for (const [index, result] of results.entries()) {
    const description = result.transaction.description.trim() || "Statement transaction";
    const rule = await applySmartRules(userId, {
      description,
      rawText: description,
    });
    payload.push({
      row_index: index,
      occurred_at: result.transaction.date,
      description,
      amount_cents: result.transaction.amountCents,
      currency: result.transaction.currency,
      suggested_category: result.transaction.suggestedCategory || null,
      account_id: accountId ?? rule.account_id ?? (await guessAccountFromText(userId, description)),
      tag_names: rule.tag_names,
      already_logged: result.alreadyLogged,
      matched_expense_id: result.matchedExpenseId ?? null,
      status: result.alreadyLogged ? "duplicate" : "pending",
    });
  }

  await sql`
    INSERT INTO statement_import_rows (
      statement_id,
      user_id,
      row_index,
      occurred_at,
      description,
      amount_cents,
      currency,
      suggested_category,
      category_id,
      account_id,
      tag_names,
      already_logged,
      matched_expense_id,
      status
    )
    SELECT
      ${statementId}::uuid,
      ${userId},
      v.row_index,
      v.occurred_at::date,
      v.description,
      v.amount_cents,
      v.currency,
      v.suggested_category,
      category_match.id,
      v.account_id,
      v.tag_names,
      v.already_logged,
      v.matched_expense_id,
      v.status
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(
      row_index INT,
      occurred_at TEXT,
      description TEXT,
      amount_cents BIGINT,
      currency CHAR(3),
      suggested_category TEXT,
      account_id UUID,
      tag_names TEXT[],
      already_logged BOOLEAN,
      matched_expense_id UUID,
      status TEXT
    )
    LEFT JOIN LATERAL (
      SELECT id
      FROM categories
      WHERE user_id = ${userId}
        AND v.suggested_category IS NOT NULL
        AND lower(name) = lower(v.suggested_category)
      LIMIT 1
    ) category_match ON TRUE
  `;
}

async function parseStatementIntoReviewRows(
  userId: number,
  statementId: string,
  buffer: Buffer,
  mimeType: string,
  accountId: string | null,
): Promise<{ parsedCount: number; duplicateCount: number; rows: StatementImportRow[] }> {
  const transactions = await parseStatementBuffer(buffer, mimeType);
  if (transactions.length === 0) {
    await updateStatementStatus(statementId, "failed", 0, "No transactions found", 0, 0);
    throw Object.assign(new Error("No transactions found in statement"), { statusCode: 422 });
  }

  const results = await dedupeTransactions(userId, transactions);
  const duplicateCount = results.filter((result) => result.alreadyLogged).length;
  await replaceStatementRows(userId, statementId, results, accountId);
  await updateStatementStatus(statementId, "parsed", results.length, null, 0, duplicateCount);

  return {
    parsedCount: results.length,
    duplicateCount,
    rows: await listStatementRows(userId, statementId),
  };
}

async function importPendingStatementRows(
  userId: number,
  statementId: string,
  actorUserId: number,
  settlementScope: "personal" | "shared",
  rowIds?: string[],
): Promise<{ importedCount: number; statement: StatementRow | null }> {
  return sql.begin(async (tx) => {
    const rows =
      rowIds && rowIds.length > 0
        ? await tx<StatementImportRow[]>`
            SELECT id,
                   statement_id::text AS statement_id,
                   row_index,
                   occurred_at::date::text AS occurred_at,
                   description,
                   amount_cents::text AS amount_cents,
                   currency,
                   suggested_category,
                   category_id::text AS category_id,
                   NULL::text AS category,
                   account_id::text AS account_id,
                   NULL::text AS account,
                   tag_names,
                   already_logged,
                   matched_expense_id::text AS matched_expense_id,
                   status,
                   imported_expense_id::text AS imported_expense_id,
                   created_at,
                   updated_at
            FROM statement_import_rows
            WHERE user_id = ${userId}
              AND statement_id = ${statementId}
              AND status = 'pending'
              AND id = ANY(${rowIds}::uuid[])
            ORDER BY row_index ASC
            FOR UPDATE
          `
        : await tx<StatementImportRow[]>`
            SELECT id,
                   statement_id::text AS statement_id,
                   row_index,
                   occurred_at::date::text AS occurred_at,
                   description,
                   amount_cents::text AS amount_cents,
                   currency,
                   suggested_category,
                   category_id::text AS category_id,
                   NULL::text AS category,
                   account_id::text AS account_id,
                   NULL::text AS account,
                   tag_names,
                   already_logged,
                   matched_expense_id::text AS matched_expense_id,
                   status,
                   imported_expense_id::text AS imported_expense_id,
                   created_at,
                   updated_at
            FROM statement_import_rows
            WHERE user_id = ${userId}
              AND statement_id = ${statementId}
              AND status = 'pending'
            ORDER BY row_index ASC
            FOR UPDATE
          `;

    let importedCount = 0;
    for (const row of rows) {
      const confidence = buildCaptureConfidence({
        amountCents: Number(row.amount_cents),
        occurredAt: new Date(`${row.occurred_at}T12:00:00Z`),
        merchant: null,
        description: row.description,
        categoryId: row.category_id,
        accountId: row.account_id,
        source: "statement",
        parser: "statement",
        rawText: row.description,
      });
      // Pass confidence as a plain object so postgres.js serializes once (no double-encoding).
      const confidenceObj = JSON.parse(JSON.stringify(confidence));
      const [inserted] = await tx<Array<{ id: string }>>`
        INSERT INTO expenses (
          user_id,
          amount_cents,
          currency,
          description,
          occurred_at,
          source,
          statement_id,
          category_id,
          account_id,
          review_status,
          confidence,
          paid_by_user_id,
          settlement_scope
        )
        VALUES (
          ${userId},
          ${Number(row.amount_cents)},
          ${row.currency},
          ${row.description},
          ${row.occurred_at}::date,
          'statement',
          ${statementId},
          ${row.category_id},
          ${row.account_id},
          'needs_review',
          ${confidenceObj},
          ${actorUserId},
          ${settlementScope}
        )
        RETURNING id
      `;
      if (!inserted) continue;

      for (const rawName of row.tag_names ?? []) {
        const name = normalizeTagName(rawName);
        if (!name) continue;
        const [tag] = await tx<Array<{ id: string }>>`
          INSERT INTO tags (user_id, name)
          VALUES (${userId}, ${name})
          ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `;
        if (!tag) continue;
        await tx`
          INSERT INTO expense_tags (expense_id, tag_id)
          VALUES (${inserted.id}, ${tag.id})
          ON CONFLICT DO NOTHING
        `;
      }

      await tx`
        UPDATE statement_import_rows
        SET status = 'imported',
            imported_expense_id = ${inserted.id},
            updated_at = NOW()
        WHERE id = ${row.id}
          AND user_id = ${userId}
      `;
      importedCount += 1;
    }

    const [{ pending_count: pendingCount }] = await tx<Array<{ pending_count: string }>>`
      SELECT COUNT(*)::text AS pending_count
      FROM statement_import_rows
      WHERE user_id = ${userId}
        AND statement_id = ${statementId}
        AND status = 'pending'
    `;

    const nextStatus = Number(pendingCount) > 0 ? "parsed" : "imported";
    const [statement] = await tx<StatementRow[]>`
      UPDATE statements
      SET status = ${nextStatus},
          imported_count = imported_count + ${importedCount},
          error_reason = NULL,
          updated_at = NOW()
      WHERE id = ${statementId}
        AND user_id = ${userId}
      RETURNING id, file_key, mime_type, status, parsed_count, imported_count,
                duplicate_count, error_reason, created_at, updated_at
    `;

    return { importedCount, statement: statement ?? null };
  });
}

export async function statementsRoutes(app: FastifyInstance) {
  app.get("/api/statements", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const rows = await sql<StatementRow[]>`
      SELECT s.id, s.file_key, s.mime_type, s.status, s.parsed_count, s.imported_count,
             s.duplicate_count, s.error_reason, s.account_id::text AS account_id,
             a.name AS account, s.created_at, s.updated_at
      FROM statements s
      LEFT JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
      WHERE s.user_id = ${session.userId}
      ORDER BY s.created_at DESC
      LIMIT 50
    `;
    return { statements: rows };
  });

  app.post<{ Querystring: { account_id?: string } }>(
    "/api/statements/upload",
    { schema: { querystring: statementUploadQuerySchema } },
    async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    // Rate-limit before any file download or LLM/vision work.
    const rlUpload = statementLimiter.allow(`statement:${session.actorUserId}`);
    if (!rlUpload.ok) {
      const secs = Math.ceil(rlUpload.retryAfterMs / 1000);
      reply.header("Retry-After", String(secs));
      return reply.status(429).send({ error: "Rate limit exceeded, try again shortly" });
    }

    const accountId = request.query.account_id ?? null;
    if (accountId && !(await accountBelongsToUser(session.userId, accountId))) {
      return reply.status(400).send({ error: "Account not found" });
    }

    let file: Awaited<ReturnType<typeof request.file>>;
    try {
      file = await request.file({ limits: { fileSize: MAX_STATEMENT_UPLOAD_BYTES } });
    } catch {
      return reply.status(413).send({ error: "Statement file is too large" });
    }
    if (!file) return reply.status(400).send({ error: "Statement file is required" });

    const mimeType = normalizeStatementMime(file.mimetype, file.filename);
    if (!mimeType) return reply.status(415).send({ error: "Unsupported statement file type" });

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.status(413).send({ error: "Statement file is too large" });
    }

    const statementId = await createStatementRecord(session.userId, "", mimeType);
    const s3Key = `statements/${session.userId}/${statementId}`;

    try {
      await uploadStatement(s3Key, buffer, mimeType);
      await sql`
        UPDATE statements
        SET file_key = ${s3Key},
            mime_type = ${mimeType},
            account_id = ${accountId},
            updated_at = NOW()
        WHERE id = ${statementId}
          AND user_id = ${session.userId}
      `;

      const review = await parseStatementIntoReviewRows(
        session.userId,
        statementId,
        buffer,
        mimeType,
        accountId,
      );
      const statement = await getStatementById(session.userId, statementId);
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "statement.upload",
        entityType: "statement",
        entityId: statementId,
        after: statement,
        metadata: {
          filename: file.filename,
          mime_type: mimeType,
          parsed_count: review.parsedCount,
          imported_count: 0,
          duplicate_count: review.duplicateCount,
          account_id: accountId,
        },
      });

      return reply.status(201).send({
        statement,
        rows: review.rows,
        parsed_count: review.parsedCount,
        imported_count: 0,
        duplicate_count: review.duplicateCount,
      });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 422) {
        return reply.status(422).send({ error: "No transactions found in statement" });
      }
      await updateStatementStatus(statementId, "failed", undefined, redactError(err));
      return reply.status(500).send({ error: "Statement upload failed" });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/statements/:id/rows",
    { schema: { params: statementParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const statement = await getStatementById(session.userId, request.params.id);
      if (!statement) return reply.status(404).send({ error: "Statement not found" });

      return { rows: await listStatementRows(session.userId, request.params.id) };
    },
  );

  app.post<{ Params: { id: string }; Body: { row_ids?: string[] } }>(
    "/api/statements/:id/import",
    { schema: { params: statementParamsSchema, body: importRowsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const before = await getStatementById(session.userId, request.params.id);
      if (!before) return reply.status(404).send({ error: "Statement not found" });

      const { importedCount, statement } = await importPendingStatementRows(
        session.userId,
        request.params.id,
        session.actorUserId,
        session.selectedLedgerKind === "household" ? "shared" : "personal",
        request.body?.row_ids,
      );

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "statement.import",
        entityType: "statement",
        entityId: request.params.id,
        before,
        after: statement,
        metadata: {
          imported_count: importedCount,
          selected_row_ids: request.body?.row_ids ?? null,
        },
      });

      return { ok: true, imported_count: importedCount, statement };
    },
  );

  app.patch<{ Params: { id: string; rowId: string }; Body: StatementRowUpdateBody }>(
    "/api/statements/:id/rows/:rowId",
    { schema: { params: statementRowParamsSchema, body: updateStatementRowSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const hasCategory = Object.prototype.hasOwnProperty.call(request.body, "category_id");
      const hasAccount = Object.prototype.hasOwnProperty.call(request.body, "account_id");
      if (
        request.body.category_id &&
        !(await categoryBelongsToUser(session.userId, request.body.category_id))
      ) {
        return reply.status(400).send({ error: "Category not found" });
      }
      if (
        request.body.account_id &&
        !(await accountBelongsToUser(session.userId, request.body.account_id))
      ) {
        return reply.status(400).send({ error: "Account not found" });
      }
      const hasTags = request.body.tag_names !== undefined;
      const tagNames = hasTags ? normalizeTagNames(request.body.tag_names ?? []) : [];
      const categoryId = request.body.category_id ?? null;
      const accountId = request.body.account_id ?? null;
      const status = request.body.status ?? "pending";

      const [before] = await sql<StatementImportRow[]>`
        SELECT r.id,
               r.statement_id::text AS statement_id,
               r.row_index,
               r.occurred_at::date::text AS occurred_at,
               r.description,
               r.amount_cents::text AS amount_cents,
               r.currency,
               r.suggested_category,
               r.category_id::text AS category_id,
               c.name AS category,
               r.account_id::text AS account_id,
               a.name AS account,
               r.tag_names,
               r.already_logged,
               r.matched_expense_id::text AS matched_expense_id,
               r.status,
               r.imported_expense_id::text AS imported_expense_id,
               r.created_at,
               r.updated_at
        FROM statement_import_rows r
        LEFT JOIN categories c ON c.id = r.category_id AND c.user_id = ${session.userId}
        LEFT JOIN accounts a ON a.id = r.account_id AND a.user_id = ${session.userId}
        WHERE r.id = ${request.params.rowId}
          AND r.statement_id = ${request.params.id}
          AND r.user_id = ${session.userId}
        LIMIT 1
      `;

      const [row] = await sql<StatementImportRow[]>`
        UPDATE statement_import_rows AS r
        SET status = CASE WHEN ${request.body.status !== undefined} THEN ${status} ELSE r.status END,
            category_id = CASE WHEN ${hasCategory} THEN ${categoryId}::uuid ELSE r.category_id END,
            account_id = CASE WHEN ${hasAccount} THEN ${accountId}::uuid ELSE r.account_id END,
            tag_names = CASE WHEN ${hasTags} THEN ${tagNames}::text[] ELSE r.tag_names END,
            updated_at = NOW()
        FROM statements s
        WHERE r.id = ${request.params.rowId}
          AND r.statement_id = ${request.params.id}
          AND r.user_id = ${session.userId}
          AND s.id = r.statement_id
          AND s.user_id = ${session.userId}
          AND r.status IN ('pending', 'ignored')
        RETURNING r.id,
                  r.statement_id::text AS statement_id,
                  r.row_index,
                  r.occurred_at::date::text AS occurred_at,
                  r.description,
                  r.amount_cents::text AS amount_cents,
                  r.currency,
                  r.suggested_category,
                  r.category_id::text AS category_id,
                  (SELECT c.name FROM categories c WHERE c.id = r.category_id AND c.user_id = ${session.userId}) AS category,
                  r.account_id::text AS account_id,
                  (SELECT a.name FROM accounts a WHERE a.id = r.account_id AND a.user_id = ${session.userId}) AS account,
                  r.tag_names,
                  r.already_logged,
                  r.matched_expense_id::text AS matched_expense_id,
                  r.status,
                  r.imported_expense_id::text AS imported_expense_id,
                  r.created_at,
                  r.updated_at
      `;
      if (!row) return reply.status(404).send({ error: "Statement row not found" });

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "statement.row_update",
        entityType: "statement",
        entityId: request.params.id,
        before,
        after: row,
        metadata: {
          row_id: request.params.rowId,
          status: request.body.status ?? null,
          category_id: hasCategory ? categoryId : undefined,
          account_id: hasAccount ? accountId : undefined,
          tag_names: hasTags ? tagNames : undefined,
        },
      });
      if (
        (hasCategory && row.category_id !== before?.category_id) ||
        (hasAccount && row.account_id !== before?.account_id) ||
        (hasTags && JSON.stringify(row.tag_names) !== JSON.stringify(before?.tag_names ?? []))
      ) {
        const pattern = suggestionPatternFromText({ description: row.description });
        if (pattern) {
          await upsertRuleSuggestion(session.userId, {
            source: "statement_row",
            sourceEntityType: "statement_row",
            sourceEntityId: row.id,
            pattern,
            matchScope: "description",
            matchType: "contains",
            categoryId: hasCategory ? row.category_id : undefined,
            accountId: hasAccount ? row.account_id : undefined,
            tagNames: hasTags ? row.tag_names : undefined,
            reason: "Statement row correction before import",
          }).catch(console.error);
        }
      }

      return row;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/statements/:id/retry",
    { schema: { params: statementParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      // Rate-limit before re-downloading and re-parsing (LLM/vision heavy).
      const rlRetry = statementLimiter.allow(`statement:${session.actorUserId}`);
      if (!rlRetry.ok) {
        const secs = Math.ceil(rlRetry.retryAfterMs / 1000);
        reply.header("Retry-After", String(secs));
        return reply.status(429).send({ error: "Rate limit exceeded, try again shortly" });
      }

      const [statement] = await sql<StatementRow[]>`
        SELECT s.id, s.file_key, s.mime_type, s.status, s.parsed_count, s.imported_count,
               s.duplicate_count, s.error_reason, s.account_id::text AS account_id,
               a.name AS account, s.created_at, s.updated_at
        FROM statements s
        LEFT JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
        WHERE s.id = ${request.params.id}
          AND s.user_id = ${session.userId}
        LIMIT 1
      `;
      if (!statement) return reply.status(404).send({ error: "Statement not found" });
      if (!statement.file_key) return reply.status(409).send({ error: "Statement file is missing" });

      try {
        await updateStatementStatus(statement.id, "pending", undefined, null, 0, 0);
        const { body, contentType } = await getObjectStream(statement.file_key);
        const buffer = await streamToBuffer(body);
        const review = await parseStatementIntoReviewRows(
          session.userId,
          statement.id,
          buffer,
          statement.mime_type ?? contentType ?? "application/pdf",
          statement.account_id,
        );
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "statement.retry",
          entityType: "statement",
          entityId: statement.id,
          metadata: {
            parsed_count: review.parsedCount,
            imported_count: 0,
            duplicate_count: review.duplicateCount,
          },
        });
        return {
          ok: true,
          rows: review.rows,
          parsed_count: review.parsedCount,
          imported_count: 0,
          duplicate_count: review.duplicateCount,
        };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 422) {
          return reply.status(422).send({ error: "No transactions found in statement" });
        }
        await updateStatementStatus(statement.id, "failed", undefined, redactError(err));
        return reply.status(500).send({ error: "Statement retry failed" });
      }
    },
  );
}
