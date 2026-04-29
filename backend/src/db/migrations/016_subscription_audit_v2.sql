-- Subscription management v2: distinguish dismissed subscriptions from inactive
-- ones, and make audit history filtering cheap for the dashboard.

ALTER TABLE subscription_preferences
  DROP CONSTRAINT IF EXISTS subscription_preferences_status_check;

ALTER TABLE subscription_preferences
  ADD CONSTRAINT subscription_preferences_status_check
  CHECK (status IN ('confirmed', 'ignored', 'inactive'));

CREATE INDEX IF NOT EXISTS audit_log_user_action_created_idx
  ON audit_log (user_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_user_entity_created_idx
  ON audit_log (user_id, entity_type, created_at DESC);
