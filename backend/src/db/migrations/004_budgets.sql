-- RAA-17: per-category monthly budgets + digest dedup state

CREATE TABLE IF NOT EXISTS category_budgets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL,
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  target_cents BIGINT NOT NULL CHECK (target_cents > 0),
  period       TEXT NOT NULL DEFAULT 'monthly' CHECK (period = 'monthly'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category_id, period)
);

CREATE INDEX IF NOT EXISTS category_budgets_user ON category_budgets (user_id);

-- Tracks last threshold notified per (user, category, month) to prevent duplicate DMs.
CREATE TABLE IF NOT EXISTS budget_digest_state (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 BIGINT NOT NULL,
  category_id             UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  year_month              CHAR(7) NOT NULL,  -- 'YYYY-MM'
  last_threshold_notified INT NOT NULL DEFAULT 0,  -- 50, 75, or 100
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category_id, year_month)
);

CREATE INDEX IF NOT EXISTS budget_digest_state_user ON budget_digest_state (user_id);
