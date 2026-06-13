-- Capture workbench metadata for replay diagnostics and operator triage.

ALTER TABLE capture_events
  ADD COLUMN IF NOT EXISTS replay_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_replayed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnosis JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS capture_events_user_replayed_idx
  ON capture_events (user_id, last_replayed_at DESC)
  WHERE last_replayed_at IS NOT NULL;
