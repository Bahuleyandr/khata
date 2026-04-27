-- Per-user correction history: maps expense description hints to user-preferred categories.
-- Used to bias future AI parses toward the user's preferences.
CREATE TABLE IF NOT EXISTS category_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL,
  hint_text     TEXT NOT NULL,      -- lowercased description/merchant from the re-categorized expense
  category_name TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, hint_text)
);

CREATE INDEX IF NOT EXISTS category_overrides_user ON category_overrides (user_id);
