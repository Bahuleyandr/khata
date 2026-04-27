import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { getSession } from "./auth.js";

export async function insightsRoutes(app: FastifyInstance) {
  // GET /api/insights — latest insight per kind for this user. Empty list if
  // the nightly cron hasn't run yet (returned as an empty array, not 404).
  app.get("/api/insights", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;

    type Row = {
      kind: string;
      payload: unknown;
      period_start: Date | null;
      period_end: Date | null;
      computed_at: Date;
    };

    const rows = await sql<Row[]>`
      SELECT DISTINCT ON (kind)
        kind, payload, period_start, period_end, computed_at
      FROM insights
      WHERE user_id = ${session.userId}
      ORDER BY kind, computed_at DESC
    `;

    return { insights: rows };
  });
}
