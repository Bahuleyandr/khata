-- Khata is India-only and single-household. Evaluate all calendar/bucketing
-- logic in IST (Asia/Kolkata, a fixed +05:30, no DST) instead of the pod's UTC.
--
-- occurred_at is TIMESTAMPTZ, so stored instants are already correct; this only
-- changes how they are *bucketed*. Two layers:
--   1. The database default session timezone (covers every client: the app
--      pool, the migration runner, cron, and manual psql).
--   2. The close-immutability trigger is made EXPLICITLY IST so the
--      money-integrity guard is correct even from a stray non-IST session.

-- 1. Durable default timezone for the current database. A DO block lets us avoid
--    hardcoding the DB name (differs across prod / local / test databases).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'Asia/Kolkata');
END
$$;

-- 2. Re-create the close-immutability trigger function bucketing occurred_at in
--    IST. Identical to migration 025 except every date_trunc now reads the IST
--    wall-clock month, matching the user-picked period_month and the IST summary
--    window, independent of the session timezone. The trigger declaration
--    (expenses_assert_month_open) from 025 already binds to this function name,
--    so CREATE OR REPLACE updates the body in place.
CREATE OR REPLACE FUNCTION khata_assert_month_open()
RETURNS TRIGGER AS $$
DECLARE
  v_closed BOOLEAN;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT EXISTS (
      SELECT 1 FROM monthly_closes
      WHERE user_id = OLD.user_id
        AND period_month = date_trunc('month', OLD.occurred_at AT TIME ZONE 'Asia/Kolkata')::date
        AND status = 'closed'
    ) INTO v_closed;
    IF v_closed THEN
      RAISE EXCEPTION 'KHATA_MONTH_CLOSED: expense % is in a closed month; reopen the month to change it', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT or UPDATE: the destination month must be open.
  SELECT EXISTS (
    SELECT 1 FROM monthly_closes
    WHERE user_id = NEW.user_id
      AND period_month = date_trunc('month', NEW.occurred_at AT TIME ZONE 'Asia/Kolkata')::date
      AND status = 'closed'
  ) INTO v_closed;
  IF v_closed THEN
    RAISE EXCEPTION 'KHATA_MONTH_CLOSED: target month for this expense is closed; reopen the month to change it';
  END IF;

  -- On UPDATE, the row must also not be leaving a closed month.
  IF (TG_OP = 'UPDATE') THEN
    SELECT EXISTS (
      SELECT 1 FROM monthly_closes
      WHERE user_id = OLD.user_id
        AND period_month = date_trunc('month', OLD.occurred_at AT TIME ZONE 'Asia/Kolkata')::date
        AND status = 'closed'
    ) INTO v_closed;
    IF v_closed THEN
      RAISE EXCEPTION 'KHATA_MONTH_CLOSED: expense % is in a closed month; reopen the month to change it', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
