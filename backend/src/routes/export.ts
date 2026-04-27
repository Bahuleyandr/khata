import type { FastifyInstance } from "fastify";
import { buildMonthlyXlsx, currentMonthBounds } from "../export/xlsx.js";
import { getSession } from "./auth.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function exportRoutes(app: FastifyInstance) {
  /**
   * GET /api/export/xlsx?year=YYYY&month=MM
   *
   * Returns a multi-sheet xlsx for the given calendar month, scoped to the
   * authenticated user. Year/month default to the current month if omitted.
   * Browser sees a download via Content-Disposition.
   */
  app.get<{ Querystring: { year?: string; month?: string } }>(
    "/api/export/xlsx",
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const now = new Date();
      const year = parseInt(request.query.year ?? String(now.getFullYear()), 10);
      const month = parseInt(request.query.month ?? String(now.getMonth() + 1), 10);
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
