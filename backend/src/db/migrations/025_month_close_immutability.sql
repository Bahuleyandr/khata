-- Enforce month-close immutability at the DATABASE layer so EVERY write path is
-- covered -- the Telegram bot (db/expenses.ts), the dashboard's inline SQL, the
-- statement importer, and the audit-undo flow -- not just the ones that remember
-- to check. Previously `monthly_closes` was a status flag that no expense write
-- path consulted, so a "closed" month could still be edited, deleted, or have
-- new rows imported into it, silently changing a signed-off total.
--
-- Once a month is 'closed', its expenses cannot be inserted, edited, deleted, or
-- moved (in or out). 'reopened' (and 'open'/'ready') periods stay fully mutable,
-- so the documented workflow is: reopen -> correct -> re-close.

CREATE OR REPLACE FUNCTION khata_assert_month_open()
RETURNS TRIGGER AS $$
DECLARE
  v_closed BOOLEAN;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT EXISTS (
      SELECT 1 FROM monthly_closes
      WHERE user_id = OLD.user_id
        AND period_month = date_trunc('month', OLD.occurred_at)::date
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
      AND period_month = date_trunc('month', NEW.occurred_at)::date
      AND status = 'closed'
  ) INTO v_closed;
  IF v_closed THEN
    RAISE EXCEPTION 'KHATA_MONTH_CLOSED: target month for this expense is closed; reopen the month to change it';
  END IF;

  -- On UPDATE, the row must also not be leaving a closed month (no moving an
  -- expense's date out of a period that has already been signed off).
  IF (TG_OP = 'UPDATE') THEN
    SELECT EXISTS (
      SELECT 1 FROM monthly_closes
      WHERE user_id = OLD.user_id
        AND period_month = date_trunc('month', OLD.occurred_at)::date
        AND status = 'closed'
    ) INTO v_closed;
    IF v_closed THEN
      RAISE EXCEPTION 'KHATA_MONTH_CLOSED: expense % is in a closed month; reopen the month to change it', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER expenses_assert_month_open
  BEFORE INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION khata_assert_month_open();
