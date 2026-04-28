-- Case-insensitive uniqueness for user-facing names.
--
-- PostgreSQL's normal UNIQUE (user_id, name) treats "Food" and "food" as
-- different values. Collapse existing case-only duplicates first, repointing
-- every dependent row to a deterministic keeper, then add expression indexes.

WITH ranked_categories AS (
  SELECT
    id,
    user_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS rn
  FROM categories
)
UPDATE expenses e
SET category_id = rc.keep_id
FROM ranked_categories rc
WHERE e.category_id = rc.id
  AND rc.rn > 1;

WITH ranked_categories AS (
  SELECT
    id,
    user_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS rn
  FROM categories
)
UPDATE merchants_canonical mc
SET category_id = rc.keep_id
FROM ranked_categories rc
WHERE mc.category_id = rc.id
  AND rc.rn > 1;

WITH ranked_categories AS (
  SELECT
    id,
    user_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id
  FROM categories
),
mapped_budgets AS (
  SELECT
    b.id,
    rc.keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY b.user_id, rc.keep_id, b.period
      ORDER BY CASE WHEN b.category_id = rc.keep_id THEN 0 ELSE 1 END, b.created_at ASC, b.id ASC
    ) AS rn
  FROM category_budgets b
  JOIN ranked_categories rc ON rc.id = b.category_id
)
DELETE FROM category_budgets b
USING mapped_budgets mb
WHERE b.id = mb.id
  AND mb.rn > 1;

WITH ranked_categories AS (
  SELECT
    id,
    user_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id
  FROM categories
),
mapped_budgets AS (
  SELECT b.id, rc.keep_id
  FROM category_budgets b
  JOIN ranked_categories rc ON rc.id = b.category_id
)
UPDATE category_budgets b
SET category_id = mb.keep_id
FROM mapped_budgets mb
WHERE b.id = mb.id
  AND b.category_id <> mb.keep_id;

WITH ranked_categories AS (
  SELECT
    id,
    user_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id
  FROM categories
),
mapped_digest_state AS (
  SELECT
    d.id,
    rc.keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY d.user_id, rc.keep_id, d.year_month
      ORDER BY CASE WHEN d.category_id = rc.keep_id THEN 0 ELSE 1 END, d.updated_at DESC, d.id ASC
    ) AS rn
  FROM budget_digest_state d
  JOIN ranked_categories rc ON rc.id = d.category_id
)
DELETE FROM budget_digest_state d
USING mapped_digest_state mds
WHERE d.id = mds.id
  AND mds.rn > 1;

WITH ranked_categories AS (
  SELECT
    id,
    user_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id
  FROM categories
),
mapped_digest_state AS (
  SELECT d.id, rc.keep_id
  FROM budget_digest_state d
  JOIN ranked_categories rc ON rc.id = d.category_id
)
UPDATE budget_digest_state d
SET category_id = mds.keep_id
FROM mapped_digest_state mds
WHERE d.id = mds.id
  AND d.category_id <> mds.keep_id;

WITH ranked_categories AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS rn
  FROM categories
)
DELETE FROM categories c
USING ranked_categories rc
WHERE c.id = rc.id
  AND rc.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS categories_user_name_lower_unique
  ON categories (user_id, lower(name));

WITH ranked_merchants AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM merchants_canonical
)
UPDATE expenses e
SET merchant_canonical_id = rm.keep_id
FROM ranked_merchants rm
WHERE e.merchant_canonical_id = rm.id
  AND rm.rn > 1;

WITH ranked_merchants AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM merchants_canonical
),
duplicate_categories AS (
  SELECT
    rm.keep_id,
    mc.category_id,
    ROW_NUMBER() OVER (
      PARTITION BY rm.keep_id
      ORDER BY mc.created_at ASC, mc.id ASC
    ) AS rn
  FROM merchants_canonical mc
  JOIN ranked_merchants rm ON rm.id = mc.id
  WHERE rm.rn > 1
    AND mc.category_id IS NOT NULL
)
UPDATE merchants_canonical keeper
SET category_id = dc.category_id
FROM duplicate_categories dc
WHERE keeper.id = dc.keep_id
  AND dc.rn = 1
  AND keeper.category_id IS NULL;

WITH ranked_merchants AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM merchants_canonical
)
DELETE FROM merchants_canonical mc
USING ranked_merchants rm
WHERE mc.id = rm.id
  AND rm.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS merchants_canonical_user_name_lower_unique
  ON merchants_canonical (user_id, lower(name));
