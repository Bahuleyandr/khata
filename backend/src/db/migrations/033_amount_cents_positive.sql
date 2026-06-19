-- 033_amount_cents_positive.sql
-- Audit 2026-06-19 L8: enforce the positive-money invariant at the schema level.
--
-- The app, and the statement-import validation added for M8, already keep
-- amount_cents positive — but nothing enforced it at the DB. Added NOT VALID so
-- the constraint guards every new INSERT/UPDATE immediately without scanning (or
-- failing on) any pre-existing row. Once prod rows are confirmed non-negative it
-- can be promoted with `ALTER TABLE expenses VALIDATE CONSTRAINT
-- expenses_amount_cents_positive;`.

ALTER TABLE expenses
  ADD CONSTRAINT expenses_amount_cents_positive CHECK (amount_cents > 0) NOT VALID;
