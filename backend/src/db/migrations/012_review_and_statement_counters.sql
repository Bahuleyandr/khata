-- Dashboard review workflow and richer statement import status.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'reviewed',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_review_status_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_review_status_check
    CHECK (review_status IN ('needs_review', 'reviewed', 'ignored'));

CREATE INDEX IF NOT EXISTS expenses_user_review_status_idx
  ON expenses (user_id, review_status, occurred_at DESC);

ALTER TABLE statements
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS imported_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS statements_user_created_recent_idx
  ON statements (user_id, created_at DESC);
