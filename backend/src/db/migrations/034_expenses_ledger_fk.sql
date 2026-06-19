-- 034_expenses_ledger_fk.sql
-- Audit 2026-06-19 M4: enforce expenses.user_id referential integrity.
--
-- expenses.user_id is the owning ledger id (personal = telegram id, household =
-- negative owner id). Nothing enforced that it referenced a real ledger; the app
-- maintains the invariant by construction. Added NOT VALID so new INSERT/UPDATE
-- are checked immediately without scanning (or failing on) pre-existing rows; it
-- can be promoted later with `ALTER TABLE expenses VALIDATE CONSTRAINT
-- fk_expenses_user_ledger;`.
--
-- Deliberately NO foreign key on paid_by_user_id: a shared expense's payer can
-- legitimately be a since-removed household member (the settlement math credits
-- such payments to the owner — audit H3), which a FK to access_users would
-- wrongly reject.

ALTER TABLE expenses
  ADD CONSTRAINT fk_expenses_user_ledger
  FOREIGN KEY (user_id) REFERENCES ledgers(id) NOT VALID;
