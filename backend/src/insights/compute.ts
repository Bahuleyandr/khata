import { sql } from "../db/index.js";
import { findSubscriptionCandidates } from "../db/query.js";
import { nowIstParts, monthStartString } from "../lib/time.js";

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
    cadence: string;
    confidence: number;
    avg_amount_cents: number;
    monthly_estimate_cents: number;
    avg_interval_days: number | null;
    interval_jitter_days: number | null;
    amount_variance_pct: number;
  }>;
}

interface MonthRange {
  start: string; // YYYY-MM-01 inclusive
  end: string;   // YYYY-MM-01 exclusive (first of next month)
}

function thisMonthBoundsIst(now: Date = new Date()): MonthRange {
  const { year, month } = nowIstParts(now);
  return { start: monthStartString(year, month), end: monthStartString(year, month + 1) };
}

function lastMonthBoundsIst(now: Date = new Date()): MonthRange {
  const { year, month } = nowIstParts(now);
  return { start: monthStartString(year, month - 1), end: monthStartString(year, month) };
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

async function computeMtdVsLastMonth(userId: number): Promise<MtdVsLastMonthPayload> {
  const mtd = thisMonthBoundsIst();
  const last = lastMonthBoundsIst();

  type CatRow = { name: string; total_cents: string };

  const [mtdTotalRow, lastTotalRow, mtdByCat, lastByCat] = await Promise.all([
    sql<Array<{ total_cents: string }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total_cents
      FROM expenses
      WHERE user_id = ${userId}
        AND occurred_at >= ${mtd.start}::date
        AND occurred_at < ${mtd.end}::date
    `,
    sql<Array<{ total_cents: string }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total_cents
      FROM expenses
      WHERE user_id = ${userId}
        AND occurred_at >= ${last.start}::date
        AND occurred_at < ${last.end}::date
    `,
    sql<CatRow[]>`
      SELECT COALESCE(c.name, 'Uncategorized') AS name,
             SUM(e.amount_cents)::text         AS total_cents
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${userId}
        AND e.occurred_at >= ${mtd.start}::date
        AND e.occurred_at < ${mtd.end}::date
      GROUP BY c.name
    `,
    sql<CatRow[]>`
      SELECT COALESCE(c.name, 'Uncategorized') AS name,
             SUM(e.amount_cents)::text         AS total_cents
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${userId}
        AND e.occurred_at >= ${last.start}::date
        AND e.occurred_at < ${last.end}::date
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
  const mtd = thisMonthBoundsIst();
  const rows = await sql<Array<{ name: string; total_cents: string; count: number }>>`
    SELECT
      COALESCE(mc.name, e.merchant)   AS name,
      SUM(e.amount_cents)::text       AS total_cents,
      COUNT(*)::int                   AS count
    FROM expenses e
    LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${mtd.start}::date
      AND e.occurred_at < ${mtd.end}::date
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
  // Dashboard recurring detection weights regular cadence and amount stability,
  // not just occurrence count. That keeps one-off frequent merchants out of the
  // subscription list.
  const rows = await findSubscriptionCandidates(userId, 6, 2);
  return {
    merchants: rows.slice(0, 8).map((r) => ({
      name: r.merchant,
      count: r.count,
      total_cents: parseInt(r.total_cents, 10),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      cadence: r.cadence,
      confidence: r.confidence,
      avg_amount_cents: parseInt(r.avg_amount_cents, 10),
      monthly_estimate_cents: parseInt(r.monthly_estimate_cents, 10),
      avg_interval_days: r.avg_interval_days,
      interval_jitter_days: r.interval_jitter_days,
      amount_variance_pct: r.amount_variance_pct,
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
  const mtd = thisMonthBoundsIst();
  const last = lastMonthBoundsIst();

  const [mtdVsLastRaw, topMerchantsRaw, recurringRaw] = await Promise.all([
    computeMtdVsLastMonth(userId),
    computeTopMerchantsMtd(userId),
    computeRecurring(userId),
  ]);

  // Pass payloads as plain objects so postgres.js serialises once (no ::jsonb cast = no double-encoding).
  const mtdVsLast = JSON.parse(JSON.stringify(mtdVsLastRaw));
  const topMerchants = JSON.parse(JSON.stringify(topMerchantsRaw));
  const recurring = JSON.parse(JSON.stringify(recurringRaw));

  await sql`
    INSERT INTO insights (user_id, kind, payload, period_start, period_end)
    VALUES
      (${userId}, 'mtd_vs_last_month', ${mtdVsLast}, ${mtd.start}, ${mtd.end}),
      (${userId}, 'top_merchants_mtd', ${topMerchants}, ${mtd.start}, ${mtd.end}),
      (${userId}, 'recurring',         ${recurring},   ${last.start}, ${mtd.end})
  `;
}
