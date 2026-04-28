-- Per-row statement review corrections before importing into expenses.

ALTER TABLE statement_import_rows
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tag_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS statement_import_rows_category_idx
  ON statement_import_rows (category_id);
