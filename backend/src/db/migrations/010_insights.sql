-- Precomputed insights for the dashboard. Each row stores one insight kind's
-- payload as JSONB; the cron writes a fresh row each night per (user_id,
-- kind). History is retained so trends can be charted later without a schema
-- change — the dashboard reads the latest row per (user_id, kind) via
-- DISTINCT ON.

CREATE TABLE IF NOT EXISTS insights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL,
  kind         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  period_start TIMESTAMPTZ,
  period_end   TIMESTAMPTZ,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS insights_user_kind_recent_idx
  ON insights (user_id, kind, computed_at DESC);
