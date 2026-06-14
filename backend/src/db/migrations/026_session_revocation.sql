-- Per-user session revocation epoch. Any session token issued (iat) before this
-- timestamp is rejected, enabling "log out everywhere" and immediate revocation
-- of a removed member's sessions.
ALTER TABLE access_users
  ADD COLUMN IF NOT EXISTS sessions_invalid_before TIMESTAMPTZ;
