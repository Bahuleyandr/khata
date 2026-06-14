import type { FastifyInstance } from "fastify";
import { buildMonthlyXlsx, currentMonthBounds } from "../export/xlsx.js";
import { getSession } from "./auth.js";
import { nowIstParts } from "../lib/time.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const exportQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
    ledger_id: { anyOf: [{ type: "integer" }, { type: "string", pattern: "^-?[0-9]+$" }] },
  },
} as const;

export async function exportRoutes(app: FastifyInstance) {
  /**
   * GET /api/export/xlsx?year=YYYY&month=MM
   *
   * Returns a multi-sheet xlsx for the given calendar month, scoped to the
   * authenticated user. Year/month default to the current month if omitted.
   * Browser sees a download via Content-Disposition.
   */
  app.get<{ Querystring: { year?: number; month?: number; ledger_id?: number | string } }>(
    "/api/export/xlsx",
    { schema: { querystring: exportQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const { year: nowYear, month: nowMonth } = nowIstParts();
      const year = Number(request.query.year ?? nowYear);
      const month = Number(request.query.month ?? nowMonth);
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return reply.status(400).send({ error: "Invalid year/month" });
      }

      const { start, end, rangeKey } = currentMonthBounds(year, month);
      const { buffer, filename } = await buildMonthlyXlsx(
        session.userId,
        start,
        end,
        rangeKey,
      );

      reply
        .header("Content-Type", XLSX_MIME)
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "private, no-store");
      return reply.send(buffer);
    },
  );
}
