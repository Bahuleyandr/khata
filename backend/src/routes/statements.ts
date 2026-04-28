import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { recordAuditEvent } from "../db/audit.js";
import { getObjectStream, uploadStatement } from "../storage/index.js";
import { parseStatementBuffer } from "../statement/parser.js";
import { dedupeTransactions } from "../statement/dedup.js";
import {
  bulkInsertTransactions,
  createStatementRecord,
  updateStatementStatus,
} from "../statement/importer.js";
import { redactError } from "../statement/redact.js";
import { getSession } from "./auth.js";

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

type StatementRow = {
  id: string;
  file_key: string;
  mime_type: string | null;
  status: string;
  parsed_count: number;
  imported_count: number;
  duplicate_count: number;
  error_reason: string | null;
  created_at: Date;
  updated_at: Date;
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

async function getStatementById(userId: number, statementId: string): Promise<StatementRow | null> {
  const [statement] = await sql<StatementRow[]>`
    SELECT id, file_key, mime_type, status, parsed_count, imported_count,
           duplicate_count, error_reason, created_at, updated_at
    FROM statements
    WHERE id = ${statementId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return statement ?? null;
}

export async function statementsRoutes(app: FastifyInstance) {
  app.get("/api/statements", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    const rows = await sql<StatementRow[]>`
      SELECT id, file_key, mime_type, status, parsed_count, imported_count,
             duplicate_count, error_reason, created_at, updated_at
      FROM statements
      WHERE user_id = ${session.userId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return { statements: rows };
  });

  app.post("/api/statements/upload", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

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
            updated_at = NOW()
        WHERE id = ${statementId}
          AND user_id = ${session.userId}
      `;

      const transactions = await parseStatementBuffer(buffer, mimeType);
      if (transactions.length === 0) {
        await updateStatementStatus(statementId, "failed", 0, "No transactions found");
        return reply.status(422).send({ error: "No transactions found in statement" });
      }

      const results = await dedupeTransactions(session.userId, transactions);
      const duplicateCount = results.filter((result) => result.alreadyLogged).length;
      const inserted = await bulkInsertTransactions(session.userId, statementId, results);
      await updateStatementStatus(
        statementId,
        "imported",
        results.length,
        null,
        inserted,
        duplicateCount,
      );

      const statement = await getStatementById(session.userId, statementId);
      await recordAuditEvent({
        userId: session.userId,
        action: "statement.upload",
        entityType: "statement",
        entityId: statementId,
        after: statement,
        metadata: {
          filename: file.filename,
          mime_type: mimeType,
          parsed_count: results.length,
          imported_count: inserted,
          duplicate_count: duplicateCount,
        },
      });

      return reply.status(201).send({
        statement,
        parsed_count: results.length,
        imported_count: inserted,
        duplicate_count: duplicateCount,
      });
    } catch (err) {
      await updateStatementStatus(statementId, "failed", undefined, redactError(err));
      return reply.status(500).send({ error: "Statement upload failed" });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/statements/:id/retry",
    { schema: { params: statementParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const [statement] = await sql<StatementRow[]>`
        SELECT id, file_key, mime_type, status, parsed_count, imported_count,
               duplicate_count, error_reason, created_at, updated_at
        FROM statements
        WHERE id = ${request.params.id}
          AND user_id = ${session.userId}
        LIMIT 1
      `;
      if (!statement) return reply.status(404).send({ error: "Statement not found" });
      if (!statement.file_key) return reply.status(409).send({ error: "Statement file is missing" });

      try {
        await updateStatementStatus(statement.id, "pending", undefined, null, 0, 0);
        const { body, contentType } = await getObjectStream(statement.file_key);
        const buffer = await streamToBuffer(body);
        const transactions = await parseStatementBuffer(
          buffer,
          statement.mime_type ?? contentType ?? "application/pdf",
        );
        const results = await dedupeTransactions(session.userId, transactions);
        const duplicateCount = results.filter((result) => result.alreadyLogged).length;
        const inserted = await bulkInsertTransactions(session.userId, statement.id, results);
        await updateStatementStatus(
          statement.id,
          "imported",
          results.length,
          null,
          inserted,
          duplicateCount,
        );
        await recordAuditEvent({
          userId: session.userId,
          action: "statement.retry",
          entityType: "statement",
          entityId: statement.id,
          metadata: {
            parsed_count: results.length,
            imported_count: inserted,
            duplicate_count: duplicateCount,
          },
        });
        return {
          ok: true,
          parsed_count: results.length,
          imported_count: inserted,
          duplicate_count: duplicateCount,
        };
      } catch (err) {
        await updateStatementStatus(statement.id, "failed", undefined, redactError(err));
        return reply.status(500).send({ error: "Statement retry failed" });
      }
    },
  );
}
