-- Defense-in-depth ownership guards for ledger-local relationships.
-- Application routes already validate these links; these triggers stop future
-- internal helpers from persisting cross-ledger category/account/statement/tag
-- references if they forget the route-level checks.

CREATE OR REPLACE FUNCTION khata_assert_category_owner(category_uuid UUID, ledger_id BIGINT, field_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF category_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.id = category_uuid AND c.user_id = ledger_id
  ) THEN
    RAISE EXCEPTION 'KHATA_OWNER_MISMATCH: %', field_name USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION khata_assert_account_owner(account_uuid UUID, ledger_id BIGINT, field_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF account_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.id = account_uuid AND a.user_id = ledger_id
  ) THEN
    RAISE EXCEPTION 'KHATA_OWNER_MISMATCH: %', field_name USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION khata_assert_statement_owner(statement_uuid UUID, ledger_id BIGINT, field_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF statement_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM statements s WHERE s.id = statement_uuid AND s.user_id = ledger_id
  ) THEN
    RAISE EXCEPTION 'KHATA_OWNER_MISMATCH: %', field_name USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION khata_assert_expense_owner(expense_uuid UUID, ledger_id BIGINT, field_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF expense_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expenses e WHERE e.id = expense_uuid AND e.user_id = ledger_id
  ) THEN
    RAISE EXCEPTION 'KHATA_OWNER_MISMATCH: %', field_name USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION expenses_assert_owned_links()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM khata_assert_category_owner(NEW.category_id, NEW.user_id, 'expenses.category_id');
  PERFORM khata_assert_account_owner(NEW.account_id, NEW.user_id, 'expenses.account_id');
  PERFORM khata_assert_statement_owner(NEW.statement_id, NEW.user_id, 'expenses.statement_id');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expenses_assert_owned_links ON expenses;
CREATE TRIGGER expenses_assert_owned_links
  BEFORE INSERT OR UPDATE OF user_id, category_id, account_id, statement_id
  ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION expenses_assert_owned_links();

CREATE OR REPLACE FUNCTION statement_import_rows_assert_owned_links()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM khata_assert_statement_owner(NEW.statement_id, NEW.user_id, 'statement_import_rows.statement_id');
  PERFORM khata_assert_category_owner(NEW.category_id, NEW.user_id, 'statement_import_rows.category_id');
  PERFORM khata_assert_account_owner(NEW.account_id, NEW.user_id, 'statement_import_rows.account_id');
  PERFORM khata_assert_expense_owner(NEW.matched_expense_id, NEW.user_id, 'statement_import_rows.matched_expense_id');
  PERFORM khata_assert_expense_owner(NEW.imported_expense_id, NEW.user_id, 'statement_import_rows.imported_expense_id');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS statement_import_rows_assert_owned_links ON statement_import_rows;
CREATE TRIGGER statement_import_rows_assert_owned_links
  BEFORE INSERT OR UPDATE OF user_id, statement_id, category_id, account_id, matched_expense_id, imported_expense_id
  ON statement_import_rows
  FOR EACH ROW
  EXECUTE FUNCTION statement_import_rows_assert_owned_links();

CREATE OR REPLACE FUNCTION expense_tags_assert_same_ledger()
RETURNS TRIGGER AS $$
DECLARE
  expense_ledger BIGINT;
  tag_ledger BIGINT;
BEGIN
  SELECT user_id INTO expense_ledger FROM expenses WHERE id = NEW.expense_id;
  SELECT user_id INTO tag_ledger FROM tags WHERE id = NEW.tag_id;

  IF expense_ledger IS NULL OR tag_ledger IS NULL OR expense_ledger <> tag_ledger THEN
    RAISE EXCEPTION 'KHATA_OWNER_MISMATCH: expense_tags' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expense_tags_assert_same_ledger ON expense_tags;
CREATE TRIGGER expense_tags_assert_same_ledger
  BEFORE INSERT OR UPDATE OF expense_id, tag_id
  ON expense_tags
  FOR EACH ROW
  EXECUTE FUNCTION expense_tags_assert_same_ledger();

CREATE OR REPLACE FUNCTION smart_rules_assert_owned_links()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM khata_assert_category_owner(NEW.category_id, NEW.user_id, 'smart_rules.category_id');
  PERFORM khata_assert_account_owner(NEW.account_id, NEW.user_id, 'smart_rules.account_id');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS smart_rules_assert_owned_links ON smart_rules;
CREATE TRIGGER smart_rules_assert_owned_links
  BEFORE INSERT OR UPDATE OF user_id, category_id, account_id
  ON smart_rules
  FOR EACH ROW
  EXECUTE FUNCTION smart_rules_assert_owned_links();
