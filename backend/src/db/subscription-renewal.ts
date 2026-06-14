/**
 * Subscription renewal engine.
 *
 * Two exported functions are registered as daily crons:
 *   advanceOverdueSubscriptions — advance next_due_at past today for overdue subs
 *   sendSubscriptionReminders   — DM users per reminder_days[], with dedup guard
 */
import { sql } from "./index.js";
import type { Api } from "grammy";
import type { BillingCycle } from "./subscription-records.js";
import { advanceUntilFuture } from "../lib/subscription-cadence.js";

interface OverdueSub {
  id: string;
  next_due_at: string;
  billing_cycle: BillingCycle;
  interval_days: number | null;
  anchor_dom: number | null;
}

/**
 * For every active/trial subscription whose next_due_at is on or before today,
 * advance next_due_at until it is strictly in the future. Returns the count of
 * subscriptions that were actually updated.
 */
export async function advanceOverdueSubscriptions(): Promise<number> {
  const rows = await sql<OverdueSub[]>`
    SELECT id,
           next_due_at::text AS next_due_at,
           billing_cycle,
           interval_days,
           anchor_dom
    FROM subscriptions
    WHERE status IN ('active', 'trial')
      AND next_due_at IS NOT NULL
      AND next_due_at <= CURRENT_DATE
  `;

  let updatedCount = 0;
  for (const sub of rows) {
    const newDue = advanceUntilFuture(
      sub.next_due_at,
      sub.billing_cycle,
      sub.interval_days,
      sub.anchor_dom,
    );
    if (newDue !== sub.next_due_at) {
      await sql`
        UPDATE subscriptions
        SET next_due_at = ${newDue}::date,
            updated_at  = NOW()
        WHERE id = ${sub.id}
      `;
      updatedCount++;
    }
  }
  return updatedCount;
}

interface ReminderSub {
  id: string;
  user_id: string;           // BIGINT returned as string by postgres.js
  name: string;
  amount_cents: string;
  currency: string;
  next_due_at: string;
  reminder_days: number[];
  days_until: number;        // (next_due_at - CURRENT_DATE)::int, always >= 0 in query
}

/**
 * For every active/trial subscription whose next_due_at is due in the next
 * max(reminder_days) days, send one DM per reminder threshold, guarded by
 * subscription_reminder_state. Each send failure is logged but does not abort
 * the batch.
 */
export async function sendSubscriptionReminders(botApi: Api): Promise<void> {
  // Pull subs that have at least one reminder threshold still relevant.
  // We fetch any sub with days_until <= max element of reminder_days.
  // The per-element guard happens in TS so we can filter precisely.
  const rows = await sql<ReminderSub[]>`
    SELECT
      s.id,
      s.user_id::text         AS user_id,
      s.name,
      s.amount_cents::text    AS amount_cents,
      s.currency,
      s.next_due_at::text     AS next_due_at,
      s.reminder_days,
      (s.next_due_at - CURRENT_DATE)::int AS days_until
    FROM subscriptions s
    WHERE s.status IN ('active', 'trial')
      AND s.next_due_at IS NOT NULL
      AND (s.next_due_at - CURRENT_DATE) BETWEEN 0 AND 90
      AND cardinality(s.reminder_days) > 0
    ORDER BY s.next_due_at, s.user_id
  `;

  for (const sub of rows) {
    const userId = Number(sub.user_id);
    const daysUntil = sub.days_until;

    for (const r of sub.reminder_days) {
      // Only fire for this reminder threshold if we're within the window.
      if (daysUntil < 0 || daysUntil > r) continue;

      // Guard: skip if we've already sent this reminder for this cycle/day.
      const [existing] = await sql<Array<{ subscription_id: string }>>`
        SELECT subscription_id
        FROM subscription_reminder_state
        WHERE subscription_id = ${sub.id}
          AND cycle_due_date  = ${sub.next_due_at}::date
          AND reminded_days   = ${r}
        LIMIT 1
      `;
      if (existing) continue;

      const amountRupees = Math.round(Number(sub.amount_cents) / 100);
      const symbol = sub.currency === "INR" ? "₹" : `${sub.currency} `;
      const msg =
        `🔔 *${sub.name}* renews in ${daysUntil}d (${symbol}${amountRupees.toLocaleString("en-IN")})`;

      try {
        await botApi.sendMessage(userId, msg, { parse_mode: "Markdown" });
        await sql`
          INSERT INTO subscription_reminder_state
            (subscription_id, user_id, cycle_due_date, reminded_days)
          VALUES
            (${sub.id}, ${userId}, ${sub.next_due_at}::date, ${r})
          ON CONFLICT (subscription_id, cycle_due_date, reminded_days) DO NOTHING
        `;
      } catch (err) {
        console.error(
          `Subscription reminder failed for sub ${sub.id} user ${userId} r=${r}:`,
          err,
        );
      }
    }
  }
}
