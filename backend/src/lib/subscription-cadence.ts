/**
 * Pure, TZ-independent calendar arithmetic for subscription cadence.
 *
 * All date math uses Date.UTC(y, m, d) so results are calendar-exact regardless
 * of the Node process timezone. No new Date() local-part access anywhere.
 */
import type { BillingCycle } from "../db/subscription-records.js";
import { todayIst } from "./time.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD string into [year, month1, day] as integers. */
function parseParts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** Format [year, month1, day] back to YYYY-MM-DD. */
function formatDate(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Last calendar day of a given month. Uses UTC to stay TZ-independent. */
function lastDayOfMonth(year: number, month1: number): number {
  // Date.UTC(y, m, 0) = last day of month m (month1-1+1, then day 0 wraps back)
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Add `months` calendar months to [year, month1, day], clamping the result day
 * to the last day of the target month. If `anchor` is provided, prefer it over
 * the current day (so a Feb-28 clamped value can restore to Mar-31 from anchor=31).
 */
function addMonths(year: number, month1: number, _day: number, months: number, anchor: number | null): string {
  const preferDay = anchor ?? _day;
  const totalMonths = (year * 12 + (month1 - 1)) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth1 = (totalMonths % 12) + 1;
  const lastDay = lastDayOfMonth(targetYear, targetMonth1);
  const targetDay = Math.min(preferDay, lastDay);
  return formatDate(targetYear, targetMonth1, targetDay);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advance `currentDueAt` by exactly one billing cycle.
 *
 * - weekly: +7 days
 * - fortnightly: +14 days
 * - monthly: +1 calendar month; day = min(anchorDom ?? currentDOM, lastDayOfTargetMonth)
 * - quarterly: +3 months (same clamp)
 * - yearly: +12 months (same clamp; Feb 29 → Feb 28 non-leap)
 * - custom: +intervalDays; if intervalDays is null → returns currentDueAt unchanged
 */
export function advanceNextDueAt(
  currentDueAt: string,
  billingCycle: BillingCycle,
  intervalDays: number | null,
  anchorDom: number | null,
): string {
  const [year, month1, day] = parseParts(currentDueAt);

  switch (billingCycle) {
    case "weekly": {
      const ms = Date.UTC(year, month1 - 1, day) + 7 * 86_400_000;
      const d = new Date(ms);
      return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    case "fortnightly": {
      const ms = Date.UTC(year, month1 - 1, day) + 14 * 86_400_000;
      const d = new Date(ms);
      return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    case "monthly":
      return addMonths(year, month1, day, 1, anchorDom);
    case "quarterly":
      return addMonths(year, month1, day, 3, anchorDom);
    case "yearly":
      return addMonths(year, month1, day, 12, anchorDom);
    case "custom":
      if (intervalDays == null) return currentDueAt;
      {
        const ms = Date.UTC(year, month1 - 1, day) + intervalDays * 86_400_000;
        const d = new Date(ms);
        return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    default: {
      // TypeScript exhaustive check
      const _: never = billingCycle;
      return currentDueAt;
    }
  }
}

/**
 * Keep calling `advanceNextDueAt` until the result is strictly after `today`.
 *
 * Safety cap: 500 iterations (a daily custom sub overdue by a year = 365 steps;
 * 500 gives headroom). If a step produces no change (custom null), breaks early.
 *
 * @param today defaults to todayIst()
 */
export function advanceUntilFuture(
  nextDueAt: string,
  billingCycle: BillingCycle,
  intervalDays: number | null,
  anchorDom: number | null,
  today: string = todayIst(),
): string {
  // Already in the future — nothing to do.
  if (nextDueAt > today) return nextDueAt;

  let current = nextDueAt;
  for (let i = 0; i < 500; i++) {
    const next = advanceNextDueAt(current, billingCycle, intervalDays, anchorDom);
    if (next === current) {
      // No-op step (custom with null intervalDays): bail to avoid infinite loop.
      break;
    }
    current = next;
    if (current > today) break;
  }
  return current;
}
