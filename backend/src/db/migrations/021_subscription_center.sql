-- Wallos-style subscription center: durable records for recurring commitments.
-- Existing subscription_preferences remain the lightweight detection decision
-- layer; this table stores the actual user-managed subscription workspace.

CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT NOT NULL,
  merchant_key    TEXT,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'trial', 'paused', 'cancelled')),
  billing_cycle   TEXT NOT NULL DEFAULT 'monthly'
                   CHECK (billing_cycle IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'custom')),
  interval_days   INT CHECK (interval_days IS NULL OR interval_days > 0),
  amount_cents    BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  payment_method  TEXT,
  started_at      DATE,
  next_due_at     DATE,
  reminder_days   INT[] NOT NULL DEFAULT ARRAY[3],
  notes           TEXT,
  logo_url        TEXT,
  source          TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual', 'detected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_merchant_unique
  ON subscriptions (user_id, merchant_key)
  WHERE merchant_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_user_status_due_idx
  ON subscriptions (user_id, status, next_due_at);

CREATE INDEX IF NOT EXISTS subscriptions_user_created_idx
  ON subscriptions (user_id, created_at DESC);
