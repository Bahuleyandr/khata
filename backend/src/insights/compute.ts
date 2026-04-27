import { sql } from "../db/index.js";
import { findRecurring } from "../db/query.js";

// Each insight kind has its own payload shape. The dashboard switches on the
// row's `kind` column to know which type the payload is.

export interface MtdVsLastMonthPayload {
  mtd_cents: number;
  last_month_cents: number;
  delta_pct: number | null;
  categories: Array<{
    name: string;
    mtd_cents: number;
    last_month_cents: number;
    delta_pct: number | null;
  }>;
}

export interface TopMerchantsMtdPayload {
  merchants: Array<{
    name: string;
    total_cents: number;
    count: number;
  }>;
}

export interface RecurringPayload {
  merchants: Array<{
    name: string;
    count: number;
    total_cents: number;
    first_seen: string;
    last_seen: string;
  }>;
}

interface MonthRange {
  start: Date;
  end: Date;
}

function thisMonthBoundsUtc(now: Date = new Date()): MonthRange {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function lastMonthBoundsUtc(now: Date = new Date()): MonthRange {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

async function computeMtdVsLastMonth(userId: number): Promise<MtdVsLastMonthPayload> {
  const mtd = thisMonthBoundsUtc();
  const last = lastMonthBoundsUtc();

  type CatRow = { name: string; total_cents: string };

  const [mtdTotalRow, lastTotalRow, mtdByCat, lastByCat] = await Promise.all([
    sql<Array<{ total_cents: string }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total_cents
      FROM expenses
      WHERE user_id = ${userId}
        AND occurred_at >= ${mtd.start}
        AND occurred_at < ${mtd.end}
    `,
    sql<Array<{ total_cents: string }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total_cents
      FROM expenses
      WHERE user_id = ${userId}
        AND occurred_at >= ${last.start}
        AND occurred_at < ${last.end}
    `,
    sql<CatRow[]>`
      SELECT COALESCE(c.name, 'Uncategorized') AS name,
             SUM(e.amount_cents)::text         AS total_cents
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${userId}
        AND e.occurred_at >= ${mtd.start}
        AND e.occurred_at < ${mtd.end}
      GROUP BY c.name
    `,
    sql<CatRow[]>`
      SELECT COALESCE(c.name, 'Uncategorized') AS name,
             SUM(e.amount_cents)::text         AS total_cents
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${userId}
        AND e.occurred_at >= ${last.start}
        AND e.occurred_at < ${last.end}
      GROUP BY c.name
    `,
  ]);

  const mtdTotal = parseInt(mtdTotalRow[0]?.total_cents ?? "0", 10);
  const lastTotal = parseInt(lastTotalRow[0]?.total_cents ?? "0", 10);

  const lastByCatMap = new Map(lastByCat.map((r) => [r.name, parseInt(r.total_cents, 10)]));
  const mtdByCatMap = new Map(mtdByCat.map((r) => [r.name, parseInt(r.total_cents, 10)]));
  const allCatNames = new Set<string>([...mtdByCatMap.keys(), ...lastByCatMap.keys()]);

  const categories = [...allCatNames]
    .map((name) => {
      const mtdCents = mtdByCatMap.get(name) ?? 0;
      const lastCents = lastByCatMap.get(name) ?? 0;
      return {
        name,
        mtd_cents: mtdCents,
        last_month_cents: lastCents,
        delta_pct: pctChange(mtdCents, lastCents),
      };
    })
    .sort((a, b) => b.mtd_cents - a.mtd_cents)
    .slice(0, 5);

  return {
    mtd_cents: mtdTotal,
    last_month_cents: lastTotal,
    delta_pct: pctChange(mtdTotal, lastTotal),
    categories,
  };
}

async function computeTopMerchantsMtd(userId: number): Promise<TopMerchantsMtdPayload> {
  const mtd = thisMonthBoundsUtc();
  const rows = await sql<Array<{ name: string; total_cents: string; count: number }>>`
    SELECT
      COALESCE(mc.name, e.merchant)   AS name,
      SUM(e.amount_cents)::text       AS total_cents,
      COUNT(*)::int                   AS count
    FROM expenses e
    LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${mtd.start}
      AND e.occurred_at < ${mtd.end}
      AND COALESCE(mc.name, e.merchant) IS NOT NULL
    GROUP BY name
    ORDER BY SUM(e.amount_cents) DESC
    LIMIT 5
  `;
  return {
    merchants: rows.map((r) => ({
      name: r.name,
      total_cents: parseInt(r.total_cents, 10),
      count: r.count,
    })),
  };
}

async function computeRecurring(userId: number): Promise<RecurringPayload> {
  // Reuse the chat-agent helper: merchants charged ≥3 times in the last 3
  // months. Tighter than /ask's defaults — the dashboard wants only the
  // strongest subscription signals.
  const rows = await findRecurring(userId, 3, 3);
  return {
    merchants: rows.slice(0, 8).map((r) => ({
      name: r.merchant,
      count: r.count,
      total_cents: parseInt(r.total_cents, 10),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    })),
  };
}

/**
 * Computes the three v1 insight kinds and persists them as fresh rows. Older
 * rows for the same (user_id, kind) stay in place — history is retained for
 * future trend charts. The /api/insights endpoint reads the latest row per
 * kind via DISTINCT ON.
 */
export async function computeAndStoreInsightsForUser(userId: number): Promise<void> {
  const mtd = thisMonthBoundsUtc();
  const last = lastMonthBoundsUtc();

  const [mtdVsLast, topMerchants, recurring] = await Promise.all([
    computeMtdVsLastMonth(userId),
    computeTopMerchantsMtd(userId),
    computeRecurring(userId),
  ]);

  await sql`
    INSERT INTO insights (user_id, kind, payload, period_start, period_end)
    VALUES
      (${userId}, 'mtd_vs_last_month', ${JSON.stringify(mtdVsLast)}::jsonb, ${mtd.start}, ${mtd.end}),
      (${userId}, 'top_merchants_mtd', ${JSON.stringify(topMerchants)}::jsonb, ${mtd.start}, ${mtd.end}),
      (${userId}, 'recurring',         ${JSON.stringify(recurring)}::jsonb,   ${last.start}, ${mtd.end})
  `;
}
