-- Persistent, auditable month-close state. The review checklist is still
-- computed from live data, while this table records explicit close actions.
CREATE TABLE IF NOT EXISTS monthly_closes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            BIGINT NOT NULL,
  period_month       DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'ready', 'closed', 'reopened')),
  readiness_score    INT NOT NULL DEFAULT 0
                       CHECK (readiness_score >= 0 AND readiness_score <= 100),
  open_task_count    INT NOT NULL DEFAULT 0 CHECK (open_task_count >= 0),
  total_cents        BIGINT NOT NULL DEFAULT 0,
  transaction_count  INT NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
  exported_at        TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  reopened_at        TIMESTAMPTZ,
  actor_user_id      BIGINT,
  close_note         TEXT,
  snapshot           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period_month)
);

CREATE INDEX IF NOT EXISTS monthly_closes_user_period_idx
  ON monthly_closes (user_id, period_month DESC);

CREATE INDEX IF NOT EXISTS monthly_closes_user_status_idx
  ON monthly_closes (user_id, status, period_month DESC);
