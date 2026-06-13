CREATE TABLE IF NOT EXISTS accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'card'
                 CHECK (type IN ('bank', 'card', 'cash', 'wallet', 'upi', 'other')),
  institution  TEXT,
  last_four    TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_name_ci_unique
  ON accounts (user_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_default_unique
  ON accounts (user_id)
  WHERE is_default AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS accounts_user_active_idx
  ON accounts (user_id, archived_at, name);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capture_event_id UUID;

ALTER TABLE statements
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE statement_import_rows
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS capture_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           BIGINT NOT NULL,
  actor_user_id     BIGINT,
  source            TEXT NOT NULL
                      CHECK (source IN (
                        'telegram_text',
                        'telegram_photo',
                        'telegram_voice',
                        'telegram_document',
                        'dashboard_manual',
                        'statement_upload'
                      )),
  raw_text          TEXT,
  file_key          TEXT,
  content_hash      TEXT,
  mime_type         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processed', 'failed', 'ignored')),
  parsed_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  error_reason      TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS capture_events_user_status_created_idx
  ON capture_events (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS capture_events_user_hash_idx
  ON capture_events (user_id, content_hash)
  WHERE content_hash IS NOT NULL;

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_capture_event_id_fkey,
  ADD CONSTRAINT expenses_capture_event_id_fkey
    FOREIGN KEY (capture_event_id) REFERENCES capture_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expenses_account_occurred_idx
  ON expenses (user_id, account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS expenses_capture_event_idx
  ON expenses (capture_event_id);

CREATE TABLE IF NOT EXISTS smart_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL,
  name          TEXT NOT NULL,
  priority      INT NOT NULL DEFAULT 100,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  match_scope   TEXT NOT NULL DEFAULT 'any'
                  CHECK (match_scope IN ('merchant', 'description', 'raw_text', 'any')),
  match_type    TEXT NOT NULL DEFAULT 'contains'
                  CHECK (match_type IN ('contains', 'equals', 'regex')),
  pattern       TEXT NOT NULL,
  category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,
  tag_names     TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  review_status TEXT CHECK (review_status IN ('needs_review', 'reviewed', 'ignored')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS smart_rules_user_enabled_priority_idx
  ON smart_rules (user_id, enabled, priority, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS smart_rules_user_name_ci_unique
  ON smart_rules (user_id, lower(name));

CREATE TABLE IF NOT EXISTS user_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL,
  kind         TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('info', 'warning', 'critical')),
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL,
  href         TEXT,
  dedupe_key   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'dismissed', 'resolved')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS user_alerts_user_dedupe_unique
  ON user_alerts (user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS user_alerts_user_status_created_idx
  ON user_alerts (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          BIGINT NOT NULL,
  account_id       UUID REFERENCES accounts(id) ON DELETE SET NULL,
  period_month     DATE NOT NULL,
  expense_count    INT NOT NULL DEFAULT 0,
  statement_count  INT NOT NULL DEFAULT 0,
  matched_count    INT NOT NULL DEFAULT 0,
  missing_in_khata INT NOT NULL DEFAULT 0,
  missing_in_statement INT NOT NULL DEFAULT 0,
  total_expense_cents BIGINT NOT NULL DEFAULT 0,
  total_statement_cents BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'computed'
                    CHECK (status IN ('computed', 'reviewed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_id, period_month)
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL,
  account_id        UUID REFERENCES accounts(id) ON DELETE SET NULL,
  expense_id        UUID REFERENCES expenses(id) ON DELETE SET NULL,
  statement_row_id  UUID REFERENCES statement_import_rows(id) ON DELETE SET NULL,
  status            TEXT NOT NULL
                     CHECK (status IN ('matched', 'missing_in_khata', 'missing_in_statement', 'amount_mismatch')),
  amount_delta_cents BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reconciliation_items_run_status_idx
  ON reconciliation_items (run_id, status);

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by BIGINT,
  ADD COLUMN IF NOT EXISTS undo_event_id UUID REFERENCES audit_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS undo_error TEXT;

CREATE INDEX IF NOT EXISTS audit_log_user_undone_idx
  ON audit_log (user_id, undone_at, created_at DESC);
