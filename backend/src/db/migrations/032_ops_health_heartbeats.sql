CREATE TABLE IF NOT EXISTS backup_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('postgres', 'minio')),
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed')),
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS backup_runs_kind_created_idx ON backup_runs (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_health_state (
  ops_kind        TEXT PRIMARY KEY,
  last_alerted_at TIMESTAMPTZ,
  last_ok_at      TIMESTAMPTZ,
  current_status  TEXT NOT NULL DEFAULT 'ok' CHECK (current_status IN ('ok', 'degraded')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
