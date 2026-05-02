-- Split authentication identity from money ledgers.
--
-- Existing `user_id` columns continue to act as the ledger key. Personal
-- ledgers use the Telegram user id. A default household ledger uses the
-- negative owner id so it cannot collide with positive Telegram user ids.

CREATE TABLE IF NOT EXISTS ledgers (
  id                     BIGINT PRIMARY KEY,
  owner_telegram_user_id BIGINT NOT NULL,
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('personal', 'household')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledgers_owner_idx
  ON ledgers (owner_telegram_user_id, kind);

CREATE TABLE IF NOT EXISTS ledger_members (
  ledger_id        BIGINT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  can_view         BOOLEAN NOT NULL DEFAULT TRUE,
  can_add          BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage       BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ,
  PRIMARY KEY (ledger_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS ledger_members_user_idx
  ON ledger_members (telegram_user_id, status, can_view);

CREATE INDEX IF NOT EXISTS ledger_members_ledger_idx
  ON ledger_members (ledger_id, status);

WITH existing_ledger_users AS (
  SELECT user_id FROM categories
  UNION SELECT user_id FROM statements
  UNION SELECT user_id FROM expenses
  UNION SELECT user_id FROM category_overrides
  UNION SELECT user_id FROM category_budgets
  UNION SELECT user_id FROM budget_digest_state
  UNION SELECT user_id FROM tags
  UNION SELECT user_id FROM merchants_canonical
  UNION SELECT user_id FROM insights
  UNION SELECT user_id FROM audit_log
  UNION SELECT user_id FROM statement_import_rows
  UNION SELECT user_id FROM subscription_preferences
  UNION SELECT telegram_user_id AS user_id FROM access_users WHERE status = 'active'
  UNION SELECT ledger_user_id AS user_id FROM access_users WHERE ledger_user_id IS NOT NULL
)
INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
SELECT DISTINCT user_id, user_id, 'Personal', 'personal'
FROM existing_ledger_users
WHERE user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

WITH existing_ledger_users AS (
  SELECT id AS user_id FROM ledgers WHERE kind = 'personal'
)
INSERT INTO ledger_members (
  ledger_id,
  telegram_user_id,
  role,
  status,
  can_view,
  can_add,
  can_manage
)
SELECT user_id, user_id, 'owner', 'active', TRUE, TRUE, TRUE
FROM existing_ledger_users
ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
SET role = 'owner',
    status = 'active',
    can_view = TRUE,
    can_add = TRUE,
    can_manage = TRUE,
    revoked_at = NULL,
    updated_at = NOW();

WITH owners AS (
  SELECT DISTINCT ledger_user_id AS owner_id
  FROM access_users
  WHERE ledger_user_id IS NOT NULL
  UNION
  SELECT id AS owner_id FROM ledgers WHERE kind = 'personal'
)
INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
SELECT -ABS(owner_id), owner_id, 'Household', 'household'
FROM owners
WHERE owner_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

WITH household_ledgers AS (
  SELECT id, owner_telegram_user_id FROM ledgers WHERE kind = 'household'
)
INSERT INTO ledger_members (
  ledger_id,
  telegram_user_id,
  role,
  status,
  can_view,
  can_add,
  can_manage
)
SELECT id, owner_telegram_user_id, 'owner', 'active', TRUE, TRUE, TRUE
FROM household_ledgers
ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
SET role = 'owner',
    status = 'active',
    can_view = TRUE,
    can_add = TRUE,
    can_manage = TRUE,
    revoked_at = NULL,
    updated_at = NOW();

-- Existing household-access members should move to the new household ledger
-- rather than continuing to see the owner's personal ledger.
INSERT INTO ledger_members (
  ledger_id,
  telegram_user_id,
  role,
  status,
  can_view,
  can_add,
  can_manage,
  invited_by
)
SELECT
  -ABS(a.ledger_user_id),
  a.telegram_user_id,
  CASE WHEN a.role = 'owner' THEN 'owner' ELSE 'member' END,
  'active',
  TRUE,
  TRUE,
  a.role = 'owner',
  a.invited_by
FROM access_users a
WHERE a.status = 'active'
  AND a.ledger_user_id IS NOT NULL
  AND a.telegram_user_id <> a.ledger_user_id
ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
SET role = EXCLUDED.role,
    status = 'active',
    can_view = TRUE,
    can_add = TRUE,
    can_manage = EXCLUDED.can_manage,
    invited_by = EXCLUDED.invited_by,
    revoked_at = NULL,
    updated_at = NOW();

-- Access rows now point at each person's personal ledger. Ledger visibility is
-- controlled by ledger_members.
UPDATE access_users
SET ledger_user_id = telegram_user_id,
    updated_at = NOW()
WHERE status = 'active';
