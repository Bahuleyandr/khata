-- Quality loop: confidence scoring, learning suggestions, settlement, and ops drill status.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS paid_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_scope TEXT NOT NULL DEFAULT 'personal';

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_settlement_scope_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_settlement_scope_check
    CHECK (settlement_scope IN ('personal', 'shared', 'reimbursable'));

CREATE INDEX IF NOT EXISTS expenses_user_settlement_month_idx
  ON expenses (user_id, settlement_scope, occurred_at DESC);

CREATE INDEX IF NOT EXISTS expenses_user_paid_by_month_idx
  ON expenses (user_id, paid_by_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS expenses_confidence_gin_idx
  ON expenses USING GIN (confidence);

ALTER TABLE capture_events
  ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS failure_kind TEXT;

CREATE INDEX IF NOT EXISTS capture_events_user_failure_created_idx
  ON capture_events (user_id, failure_kind, created_at DESC)
  WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS rule_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           BIGINT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'correction'
                     CHECK (source IN ('correction', 'statement_row', 'bulk_correction')),
  source_entity_type TEXT,
  source_entity_id   UUID,
  merchant          TEXT,
  pattern           TEXT NOT NULL,
  match_scope       TEXT NOT NULL DEFAULT 'any'
                     CHECK (match_scope IN ('merchant', 'description', 'raw_text', 'any')),
  match_type        TEXT NOT NULL DEFAULT 'contains'
                     CHECK (match_type IN ('contains', 'equals', 'regex')),
  category_id       UUID REFERENCES categories(id) ON DELETE SET NULL,
  account_id        UUID REFERENCES accounts(id) ON DELETE SET NULL,
  tag_names         TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'dismissed')),
  smart_rule_id     UUID REFERENCES smart_rules(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rule_suggestions_user_status_created_idx
  ON rule_suggestions (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS rule_suggestions_user_pending_pattern_unique
  ON rule_suggestions (user_id, lower(pattern))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS restore_drills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'passed', 'failed')),
  backup_key      TEXT,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms     INT,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_reason    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS restore_drills_checked_idx
  ON restore_drills (checked_at DESC);
