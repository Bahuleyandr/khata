-- DB-backed access management for a shared household ledger.
--
-- The historical model scoped all money data to `user_id`, which is the
-- Telegram ID of the ledger owner.  This table lets additional Telegram users
-- authenticate as themselves while reading/writing the owner's ledger.

CREATE TABLE IF NOT EXISTS access_users (
  telegram_user_id BIGINT PRIMARY KEY,
  first_name       TEXT,
  username         TEXT,
  role             TEXT NOT NULL DEFAULT 'member'
                     CHECK (role IN ('owner', 'member')),
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'pending', 'revoked')),
  ledger_user_id   BIGINT,
  invited_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at    TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  CHECK (status <> 'active' OR ledger_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS access_users_ledger_status_idx
  ON access_users (ledger_user_id, status);

CREATE INDEX IF NOT EXISTS access_users_status_updated_idx
  ON access_users (status, updated_at DESC);

-- Any Telegram user that already owns data should remain an active owner of
-- their own existing ledger after this migration. Config allowlist users with
-- no data yet are inserted lazily on first login or when /api/access/users is
-- opened by the owner.
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
)
INSERT INTO access_users (
  telegram_user_id,
  role,
  status,
  ledger_user_id,
  created_at,
  updated_at
)
SELECT DISTINCT user_id, 'owner', 'active', user_id, NOW(), NOW()
FROM existing_ledger_users
ON CONFLICT (telegram_user_id) DO NOTHING;
