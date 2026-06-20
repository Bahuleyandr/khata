-- 035_app_role.sql
-- Audit 2026-06-19 M5 (real fix): give the application a least-privilege DB role
-- instead of connecting as the table owner.
--
-- The app previously connected as the owner/superuser role, which can
-- `ALTER TABLE ... DISABLE TRIGGER` and so bypass the month-close immutability
-- and updated_at triggers. `khata_app` is a non-owner role with DML only: it
-- can SELECT/INSERT/UPDATE/DELETE (and its writes still fire the triggers), but
-- it CANNOT disable triggers, DDL, or TRUNCATE. Migrations keep running as the
-- owner. The role's LOGIN password is provisioned out-of-band by migrate.ts
-- from APP_DB_PASSWORD (so it is never in version control); under trust auth
-- (CI/smoke) the password-less LOGIN role connects directly.
--
-- Written to run as whichever role applies migrations: `postgres` in CI, the
-- `khata` owner in prod. CONNECT is granted on current_database() and default
-- privileges are set for the current role, so it is correct in both.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khata_app') THEN
    CREATE ROLE khata_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO khata_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO khata_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO khata_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO khata_app;

-- Future tables/sequences created by the migrating (owner) role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO khata_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO khata_app;
