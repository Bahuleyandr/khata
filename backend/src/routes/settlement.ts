import type { FastifyInstance } from "fastify";
import { computeHouseholdSettlement } from "../db/settlements.js";
import { getSession } from "./auth.js";
import { nowIstParts } from "../lib/time.js";

type SettlementQuery = {
  year?: number;
  month?: number;
};

const settlementQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    year: { type: "integer", minimum: 2000, maximum: 2100 },
    month: { type: "integer", minimum: 1, maximum: 12 },
  },
} as const;

function selectedMonth(query: SettlementQuery): { year: number; month: number } {
  const { year, month } = nowIstParts();
  return {
    year: query.year ?? year,
    month: query.month ?? month,
  };
}

export async function settlementRoutes(app: FastifyInstance) {
  app.get<{ Querystring: SettlementQuery }>(
    "/api/settlement/monthly",
    { schema: { querystring: settlementQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      if (session.selectedLedgerKind !== "household") {
        return {
          settlement: {
            period: { ...selectedMonth(request.query), start: "", end: "", label: "" },
            total_cents: "0",
            member_count: 1,
            payers: [],
            transfers: [],
          },
        };
      }
      const { year, month } = selectedMonth(request.query);
      return { settlement: await computeHouseholdSettlement(session.userId, year, month) };
    },
  );
}
