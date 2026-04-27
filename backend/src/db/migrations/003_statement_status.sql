-- Align statement status values with the import pipeline spec:
-- pending → parsed → imported (or failed with reason)
ALTER TABLE statements
  DROP CONSTRAINT IF EXISTS statements_status_check;

ALTER TABLE statements
  ADD CONSTRAINT statements_status_check
    CHECK (status IN ('pending', 'parsed', 'imported', 'failed'));

-- Store failure reason for debugging
ALTER TABLE statements
  ADD COLUMN IF NOT EXISTS error_reason TEXT;
