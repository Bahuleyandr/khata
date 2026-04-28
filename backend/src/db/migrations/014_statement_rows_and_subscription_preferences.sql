-- Reviewable statement import rows and user subscription decisions.

CREATE TABLE IF NOT EXISTS statement_import_rows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id         UUID NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  user_id              BIGINT NOT NULL,
  row_index            INT NOT NULL,
  occurred_at          DATE NOT NULL,
  description          TEXT NOT NULL,
  amount_cents         BIGINT NOT NULL,
  currency             CHAR(3) NOT NULL DEFAULT 'INR',
  suggested_category   TEXT,
  already_logged       BOOLEAN NOT NULL DEFAULT FALSE,
  matched_expense_id   UUID REFERENCES expenses(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'imported', 'ignored', 'duplicate')),
  imported_expense_id  UUID REFERENCES expenses(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (statement_id, row_index)
);

CREATE INDEX IF NOT EXISTS statement_import_rows_statement_status_idx
  ON statement_import_rows (statement_id, status);

CREATE INDEX IF NOT EXISTS statement_import_rows_user_created_idx
  ON statement_import_rows (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_preferences (
  user_id        BIGINT NOT NULL,
  merchant_key   TEXT NOT NULL,
  merchant_name  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('confirmed', 'ignored')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, merchant_key)
);

CREATE INDEX IF NOT EXISTS subscription_preferences_user_status_idx
  ON subscription_preferences (user_id, status);
