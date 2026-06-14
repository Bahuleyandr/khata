-- Subscription renewal engine: anchor_dom + reminder-state dedup table.
-- advance/reminder logic is in TS (subscription-cadence.ts + subscription-renewal.ts).

-- Billing day-of-month anchor so monthly+ advances don't drift after end-of-month clamp.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS anchor_dom INT
  CHECK (anchor_dom IS NULL OR (anchor_dom BETWEEN 1 AND 31));

-- Backfill anchor_dom from the current next_due_at (or started_at as fallback)
-- for cycles where DOM is meaningful.
UPDATE subscriptions
SET anchor_dom = EXTRACT(DAY FROM COALESCE(next_due_at, started_at))::int
WHERE billing_cycle IN ('monthly', 'quarterly', 'yearly')
  AND COALESCE(next_due_at, started_at) IS NOT NULL
  AND anchor_dom IS NULL;

-- Per-cycle, per-day reminder dedup: prevents re-sending when the cron fires
-- multiple times, and resets automatically when next_due_at advances (old rows
-- carry the previous cycle_due_date and are therefore ignored by the guard).
CREATE TABLE IF NOT EXISTS subscription_reminder_state (
  subscription_id UUID     NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id         BIGINT   NOT NULL,
  cycle_due_date  DATE     NOT NULL,
  reminded_days   INT      NOT NULL,
  reminded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id, cycle_due_date, reminded_days)
);

CREATE INDEX IF NOT EXISTS srs_user_cycle_idx
  ON subscription_reminder_state (user_id, cycle_due_date);
