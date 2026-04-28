import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getObjectStream } from "../storage/index.js";
import { parseStatementBuffer } from "../statement/parser.js";
import { dedupeTransactions } from "../statement/dedup.js";
import { bulkInsertTransactions, updateStatementStatus } from "../statement/importer.js";
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

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
