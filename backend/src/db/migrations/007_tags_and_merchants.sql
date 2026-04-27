-- Per-user free-form tags, many-to-many with expenses.
-- Tag names are normalized to lowercase + single-space; uniqueness is per user.
CREATE TABLE IF NOT EXISTS tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     BIGINT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS tags_user_idx ON tags (user_id);

CREATE TABLE IF NOT EXISTS expense_tags (
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, tag_id)
);
CREATE INDEX IF NOT EXISTS expense_tags_tag_idx ON expense_tags (tag_id);

-- Per-user canonical merchant names, plus an FK on expenses.
-- First-cut normalization is case-insensitive exact match (lowercase + single
-- space). Future iteration can layer fuzzy matching (pg_trgm) on top.
CREATE TABLE IF NOT EXISTS merchants_canonical (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     BIGINT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS merchants_canonical_user_idx ON merchants_canonical (user_id);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS merchant_canonical_id UUID
    REFERENCES merchants_canonical(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_merchant_canonical_idx ON expenses (merchant_canonical_id);
