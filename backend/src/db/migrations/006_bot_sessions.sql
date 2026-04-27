CREATE TABLE IF NOT EXISTS bot_sessions (
  session_key TEXT NOT NULL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('pending_import', 'pending_edit')),
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes'
);
CREATE INDEX IF NOT EXISTS bot_sessions_expires_at_idx ON bot_sessions (expires_at);
