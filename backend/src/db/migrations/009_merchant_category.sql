-- Per-merchant remembered category. When the user corrects an expense's
-- category (via "category: X" reply or the inline keyboard), we persist the
-- learned mapping here so future expenses at the same merchant skip the LLM
-- classification and use the learned category directly.
--
-- Description-keyed `category_overrides` (migration 002) stays in place — it
-- still helps when the merchant is null (e.g. manual "lunch 200" entries).

ALTER TABLE merchants_canonical
  ADD COLUMN IF NOT EXISTS category_id UUID
    REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS merchants_canonical_category_idx
  ON merchants_canonical (category_id) WHERE category_id IS NOT NULL;

-- One-shot backfill: for each merchant_canonical, set category_id to the
-- most-frequently-used category from past expenses at that merchant. Only
-- updates rows where category_id is still NULL, so the migration is safe to
-- re-run.
WITH counts AS (
  SELECT
    merchant_canonical_id,
    category_id,
    COUNT(*) AS n,
    ROW_NUMBER() OVER (
      PARTITION BY merchant_canonical_id
      ORDER BY COUNT(*) DESC, MAX(created_at) DESC
    ) AS rn
  FROM expenses
  WHERE merchant_canonical_id IS NOT NULL
    AND category_id IS NOT NULL
  GROUP BY merchant_canonical_id, category_id
)
UPDATE merchants_canonical mc
SET category_id = c.category_id
FROM counts c
WHERE c.merchant_canonical_id = mc.id
  AND c.rn = 1
  AND mc.category_id IS NULL;
