-- Case-insensitive uniqueness for user-facing names.
--
-- PostgreSQL's normal UNIQUE (user_id, name) treats "Food" and "food" as
-- different values. That is hostile for a chat-first expense tracker: users
-- naturally type category and merchant names with varying case. Before adding
-- expression indexes, collapse any existing case-only duplicates into a
-- deterministic keeper row and repoint dependents.

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
SET category_id = ranked.keep_id
FROM ranked
WHERE e.category_id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
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
SET category_id = ranked.keep_id
FROM ranked
WHERE mc.category_id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
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
),
mapped_budgets AS (
  SELECT
    b.id,
    r.keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY b.user_id, r.keep_id, b.period
      ORDER BY CASE WHEN r.id = r.keep_id THEN 0 ELSE 1 END, b.created_at ASC, b.id ASC
    ) AS rn
  FROM category_budgets b
  JOIN ranked_categories r ON r.id = b.category_id
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
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY is_default DESC, created_at ASC, id ASC
    ) AS rn
  FROM categories
),
mapped_budgets AS (
  SELECT b.id, r.keep_id
  FROM category_budgets b
  JOIN ranked_categories r ON r.id = b.category_id
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
    r.keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY d.user_id, r.keep_id, d.year_month
      ORDER BY CASE WHEN r.id = r.keep_id THEN 0 ELSE 1 END, d.updated_at DESC, d.id ASC
    ) AS rn
  FROM budget_digest_state d
  JOIN ranked_categories r ON r.id = d.category_id
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
  SELECT d.id, r.keep_id
  FROM budget_digest_state d
  JOIN ranked_categories r ON r.id = d.category_id
)
UPDATE budget_digest_state d
SET category_id = mds.keep_id
FROM mapped_digest_state mds
WHERE d.id = mds.id
  AND d.category_id <> mds.keep_id;

WITH ranked AS (
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
USING ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS categories_user_name_lower_unique
  ON categories (user_id, lower(name));

WITH ranked AS (
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
SET merchant_canonical_id = ranked.keep_id
FROM ranked
WHERE e.merchant_canonical_id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
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
    keep_id,
    category_id,
    ROW_NUMBER() OVER (
      PARTITION BY keep_id
      ORDER BY mc.created_at ASC, mc.id ASC
    ) AS rn
  FROM merchants_canonical mc
  JOIN ranked ON ranked.id = mc.id
  WHERE ranked.rn > 1
    AND mc.category_id IS NOT NULL
)
UPDATE merchants_canonical keeper
SET category_id = duplicate_categories.category_id
FROM duplicate_categories
WHERE keeper.id = duplicate_categories.keep_id
  AND duplicate_categories.rn = 1
  AND keeper.category_id IS NULL;

WITH ranked AS (
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
USING ranked
WHERE mc.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS merchants_canonical_user_name_lower_unique
  ON merchants_canonical (user_id, lower(name));
