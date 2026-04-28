import { sql } from "./index.js";

export interface SpendTotal {
  total_cents: string;
  currency: string;
  count: number;
}

export interface CategorySpend {
  category: string;
  total_cents: string;
  currency: string;
  count: number;
}

export interface TopExpense {
  id: string;
  description: string;
  merchant: string | null;
  occurred_at: Date;
  amount_cents: string;
  currency: string;
  category: string | null;
}

export async function totalSpendInCategory(
  userId: number,
  category: string | undefined,
  start: string,
  end: string,
): Promise<SpendTotal[]> {
  if (category) {
    return sql<SpendTotal[]>`
      SELECT SUM(e.amount_cents)::text AS total_cents, e.currency, COUNT(*)::int AS count
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.user_id = ${userId}
        AND c.name ILIKE ${category}
        AND e.occurred_at >= ${start}::date
        AND e.occurred_at < (${end}::date + INTERVAL '1 day')
      GROUP BY e.currency
    `;
  }
  return sql<SpendTotal[]>`
    SELECT SUM(e.amount_cents)::text AS total_cents, e.currency, COUNT(*)::int AS count
    FROM expenses e
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    GROUP BY e.currency
  `;
}

export async function topExpenses(
  userId: number,
  start: string,
  end: string,
  limit: number,
): Promise<TopExpense[]> {
  return sql<TopExpense[]>`
    SELECT e.id, e.description, e.merchant, e.occurred_at,
           e.amount_cents::text AS amount_cents, e.currency,
           COALESCE(c.name, 'Uncategorized') AS category
    FROM expenses e
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    ORDER BY e.amount_cents DESC
    LIMIT ${limit}
  `;
}

export async function spendByCategory(
  userId: number,
  start: string,
  end: string,
): Promise<CategorySpend[]> {
  return sql<CategorySpend[]>`
    SELECT COALESCE(c.name, 'Uncategorized') AS category,
           SUM(e.amount_cents)::text AS total_cents, e.currency,
           COUNT(*)::int AS count
    FROM expenses e
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    GROUP BY c.name, e.currency
    ORDER BY SUM(e.amount_cents) DESC
  `;
}

export interface ExportRow {
  date: string;
  amount_cents: number;
  currency: string;
  category: string;
  merchant: string;
  merchant_canonical: string;
  description: string;
  source: string;
  tags: string[];
}

export async function getExpensesForExport(
  userId: number,
  start: string,
  end: string,
): Promise<ExportRow[]> {
  return sql<ExportRow[]>`
    SELECT
      e.occurred_at::date::text         AS date,
      e.amount_cents::int               AS amount_cents,
      e.currency,
      COALESCE(c.name, 'Uncategorized') AS category,
      COALESCE(e.merchant, '')          AS merchant,
      COALESCE(mc.name, '')             AS merchant_canonical,
      COALESCE(e.description, '')       AS description,
      e.source,
      COALESCE(
        (SELECT array_agg(t.name ORDER BY t.name)
         FROM tags t
         JOIN expense_tags et ON et.tag_id = t.id
         WHERE et.expense_id = e.id),
        ARRAY[]::text[]
      ) AS tags
    FROM expenses e
    LEFT JOIN categories c          ON e.category_id           = c.id
    LEFT JOIN merchants_canonical mc ON e.merchant_canonical_id = mc.id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
    ORDER BY e.occurred_at ASC
  `;
}

/** Distinct user IDs that have at least one expense in the given range. */
export async function getDistinctUsersWithExpensesIn(
  start: string,
  end: string,
): Promise<number[]> {
  const rows = await sql<Array<{ user_id: number }>>`
    SELECT DISTINCT user_id FROM expenses
    WHERE occurred_at >= ${start}::date
      AND occurred_at < (${end}::date + INTERVAL '1 day')
  `;
  return rows.map((r) => r.user_id);
}

// ── Helpers used by the chat-with-data agent ────────────────────────────────

export interface MerchantSpend {
  merchant: string;
  total_cents: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface SubscriptionCandidate extends MerchantSpend {
  cadence: "weekly" | "fortnightly" | "monthly" | "quarterly" | "irregular";
  confidence: number;
  avg_amount_cents: string;
  monthly_estimate_cents: string;
  avg_interval_days: number | null;
  interval_jitter_days: number | null;
  amount_variance_pct: number;
  charge_dates: string[];
}

/**
 * Find recurring expenses — merchants charged at least N times in the last
 * `lookback_months` months, ordered by occurrence count desc. Useful for
 * subscription detection.
 */
export async function findRecurring(
  userId: number,
  lookbackMonths: number,
  minOccurrences: number,
): Promise<MerchantSpend[]> {
  return sql<MerchantSpend[]>`
    SELECT
      COALESCE(mc.name, e.merchant, '(unknown)') AS merchant,
      SUM(e.amount_cents)::text                  AS total_cents,
      COUNT(*)::int                              AS count,
      MIN(e.occurred_at)::date::text             AS first_seen,
      MAX(e.occurred_at)::date::text             AS last_seen
    FROM expenses e
    LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= NOW() - (${lookbackMonths} || ' months')::interval
      AND COALESCE(mc.name, e.merchant) IS NOT NULL
    GROUP BY merchant
    HAVING COUNT(*) >= ${minOccurrences}
    ORDER BY count DESC, total_cents DESC
    LIMIT 50
  `;
}

function cadenceFromInterval(avgIntervalDays: number | null): SubscriptionCandidate["cadence"] {
  if (avgIntervalDays === null) return "irregular";
  if (avgIntervalDays >= 5 && avgIntervalDays <= 9) return "weekly";
  if (avgIntervalDays >= 12 && avgIntervalDays <= 17) return "fortnightly";
  if (avgIntervalDays >= 26 && avgIntervalDays <= 35) return "monthly";
  if (avgIntervalDays >= 80 && avgIntervalDays <= 100) return "quarterly";
  return "irregular";
}

function stabilizeCadence(
  cadence: SubscriptionCandidate["cadence"],
  avgIntervalDays: number | null,
  intervalJitterDays: number | null,
): SubscriptionCandidate["cadence"] {
  if (cadence === "irregular" || avgIntervalDays === null || intervalJitterDays === null) {
    return cadence;
  }
  const jitterLimit = Math.max(5, avgIntervalDays * 0.35);
  return intervalJitterDays > jitterLimit ? "irregular" : cadence;
}

function monthlyEstimate(avgAmountCents: number, cadence: SubscriptionCandidate["cadence"]): number {
  if (cadence === "weekly") return Math.round(avgAmountCents * 4.33);
  if (cadence === "fortnightly") return Math.round(avgAmountCents * 2.17);
  if (cadence === "quarterly") return Math.round(avgAmountCents / 3);
  return Math.round(avgAmountCents);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function scoreSubscription(input: {
  count: number;
  cadence: SubscriptionCandidate["cadence"];
  avgIntervalDays: number | null;
  intervalJitterDays: number | null;
  amountVariancePct: number;
  lastSeen: Date;
}): number {
  let score = 0;
  if (input.count >= 2) score += 15;
  if (input.count >= 3) score += 15;
  if (input.count >= 4) score += 10;
  if (input.cadence !== "irregular") score += 25;
  if (input.intervalJitterDays !== null) {
    const jitterLimit = input.avgIntervalDays !== null && input.avgIntervalDays < 10 ? 2 : 5;
    if (input.intervalJitterDays <= jitterLimit) score += 20;
    else if (input.intervalJitterDays <= jitterLimit * 2) score += 10;
  }
  if (input.amountVariancePct <= 5) score += 15;
  else if (input.amountVariancePct <= 15) score += 8;
  if (daysBetween(input.lastSeen, new Date()) <= 45) score += 10;
  return Math.min(100, score);
}

/**
 * Detect likely subscriptions by combining occurrence count, charge cadence,
 * and amount stability. This is stricter than simple "charged N times" and is
 * meant for dashboard review, where false positives are annoying.
 */
export async function findSubscriptionCandidates(
  userId: number,
  lookbackMonths: number = 6,
  minOccurrences: number = 2,
): Promise<SubscriptionCandidate[]> {
  type Row = {
    merchant: string;
    total_cents: string;
    count: number;
    first_seen: string;
    last_seen: string;
    avg_amount_cents: string;
    min_amount_cents: string;
    max_amount_cents: string;
    charge_dates: Array<string | Date>;
  };

  const rows = await sql<Row[]>`
    WITH merchant_rows AS (
      SELECT
        lower(COALESCE(mc.name, e.merchant, e.description)) AS merchant_key,
        COALESCE(mc.name, e.merchant, e.description) AS merchant,
        e.amount_cents,
        e.occurred_at::date AS charge_date
      FROM expenses e
      LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
      WHERE e.user_id = ${userId}
        AND e.amount_cents > 0
        AND e.occurred_at >= NOW() - (${lookbackMonths} || ' months')::interval
        AND COALESCE(mc.name, e.merchant, e.description) IS NOT NULL
    )
    SELECT
      MIN(merchant) AS merchant,
      SUM(amount_cents)::text AS total_cents,
      COUNT(*)::int AS count,
      MIN(charge_date)::text AS first_seen,
      MAX(charge_date)::text AS last_seen,
      ROUND(AVG(amount_cents))::bigint::text AS avg_amount_cents,
      MIN(amount_cents)::text AS min_amount_cents,
      MAX(amount_cents)::text AS max_amount_cents,
      ARRAY_AGG(charge_date ORDER BY charge_date) AS charge_dates
    FROM merchant_rows
    GROUP BY merchant_key
    HAVING COUNT(*) >= ${minOccurrences}
    ORDER BY COUNT(*) DESC, SUM(amount_cents) DESC
    LIMIT 50
  `;

  return rows
    .map((row) => {
      const dates = row.charge_dates.map((value) => new Date(value));
      const intervals = dates.slice(1).map((date, index) => daysBetween(dates[index]!, date));
      const avgIntervalDays =
        intervals.length > 0
          ? Math.round(intervals.reduce((sum, days) => sum + days, 0) / intervals.length)
          : null;
      const intervalJitterDays =
        intervals.length > 0 && avgIntervalDays !== null
          ? Math.round(
              (intervals.reduce((sum, days) => sum + Math.abs(days - avgIntervalDays), 0) /
                intervals.length) *
                10,
            ) / 10
          : null;
      const avgAmount = Number(row.avg_amount_cents);
      const amountVariancePct =
        avgAmount > 0
          ? Math.round(((Number(row.max_amount_cents) - Number(row.min_amount_cents)) / avgAmount) * 100)
          : 0;
      const cadence = stabilizeCadence(
        cadenceFromInterval(avgIntervalDays),
        avgIntervalDays,
        intervalJitterDays,
      );
      const confidence = scoreSubscription({
        count: row.count,
        cadence,
        avgIntervalDays,
        intervalJitterDays,
        amountVariancePct,
        lastSeen: new Date(row.last_seen),
      });

      return {
        merchant: row.merchant,
        total_cents: row.total_cents,
        count: row.count,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        cadence,
        confidence,
        avg_amount_cents: row.avg_amount_cents,
        monthly_estimate_cents: String(monthlyEstimate(avgAmount, cadence)),
        avg_interval_days: avgIntervalDays,
        interval_jitter_days: intervalJitterDays,
        amount_variance_pct: amountVariancePct,
        charge_dates: dates.map((date) => date.toISOString().slice(0, 10)),
      };
    })
    .filter((row) => row.confidence >= 55)
    .sort((a, b) => b.confidence - a.confidence || b.count - a.count || Number(b.total_cents) - Number(a.total_cents))
    .slice(0, 12);
}

export interface ExpenseAtMerchant {
  id: string;
  occurred_at: string;
  amount_cents: string;
  currency: string;
  description: string | null;
  merchant: string | null;
  category: string;
}

/**
 * Find expenses where the raw or canonical merchant matches the given
 * substring (case-insensitive ILIKE). Newest first.
 */
export async function findExpensesAtMerchant(
  userId: number,
  merchantSubstring: string,
  start: string,
  end: string,
  limit: number = 50,
): Promise<ExpenseAtMerchant[]> {
  const pattern = `%${merchantSubstring}%`;
  return sql<ExpenseAtMerchant[]>`
    SELECT
      e.id,
      e.occurred_at::date::text         AS occurred_at,
      e.amount_cents::text              AS amount_cents,
      e.currency,
      e.description,
      e.merchant,
      COALESCE(c.name, 'Uncategorized') AS category
    FROM expenses e
    LEFT JOIN categories c           ON c.id  = e.category_id
    LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
    WHERE e.user_id = ${userId}
      AND e.occurred_at >= ${start}::date
      AND e.occurred_at < (${end}::date + INTERVAL '1 day')
      AND (e.merchant ILIKE ${pattern} OR mc.name ILIKE ${pattern})
    ORDER BY e.occurred_at DESC
    LIMIT ${limit}
  `;
}
