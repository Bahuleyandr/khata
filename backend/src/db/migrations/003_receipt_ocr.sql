-- RAA-11: receipt OCR ingest — image storage and idempotency columns

ALTER TABLE expenses ADD COLUMN image_key TEXT;
ALTER TABLE expenses ADD COLUMN content_hash TEXT;

-- Prevent double-logging the same receipt image
CREATE UNIQUE INDEX expenses_user_content_hash_unique
  ON expenses (user_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- Expand source enum to include 'receipt'
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_source_check
  CHECK (source IN ('manual', 'telegram', 'statement', 'receipt'));
