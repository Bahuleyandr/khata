/**
 * DB helpers for integration tests.
 *
 * Top-level imports are safe here: vitest globalSetup runs before any test
 * file is imported, and globalSetup sets all required env vars (DATABASE_URL
 * etc.) before this module is first evaluated in test worker processes.
 */
import { sql } from "../db/index.js";
import {
  insertExpense,
  getExpenseForEdit,
} from "../db/expenses.js";
import {
  recordCaptureEvent,
  markCaptureFailed,
  listCaptureEvents,
} from "../db/captures.js";
import {
  closeMonthlyPeriod,
} from "../db/monthly-closes.js";
import {
  isActiveLedgerMember,
} from "../db/access.js";
import {
  setBudget,
  getBudgetsWithMtd,
} from "../db/budgets.js";
import {
  advanceOverdueSubscriptions,
} from "../db/subscription-renewal.js";

// Re-export the real db functions so test files can import from one place.
export {
  sql,
  insertExpense,
  getExpenseForEdit,
  recordCaptureEvent,
  markCaptureFailed,
  listCaptureEvents,
  closeMonthlyPeriod,
  isActiveLedgerMember,
  setBudget,
  getBudgetsWithMtd,
  advanceOverdueSubscriptions,
};

/**
 * TRUNCATE all money/access tables in FK-safe order.
 * TRUNCATE does not fire row-level triggers (only statement-level TRUNCATE
 * triggers, which this schema has none of), so the month-close immutability
 * trigger (which fires on INSERT/UPDATE/DELETE) does not block cleanup of
 * closed months' expenses — no session_replication_role bypass is needed.
 */
export async function truncateAll(): Promise<void> {
  // TRUNCATE with RESTART IDENTITY CASCADE handles FK ordering for us.
  // We run it in a transaction so all locks are acquired at once.
  // We do NOT need to bypass triggers here because TRUNCATE doesn't fire
  // row-level triggers (only statement-level TRUNCATE triggers, which this
  // schema has none of). The month-close immutability trigger fires on
  // INSERT/UPDATE/DELETE, not TRUNCATE — so we can safely truncate a
  // closed month's expenses without triggering KHATA_MONTH_CLOSED.
  await sql.unsafe(`
    TRUNCATE
      subscription_reminder_state,
      subscriptions,
      expense_tags,
      tags,
      audit_log,
      statement_import_rows,
      capture_events,
      expenses,
      monthly_closes,
      category_budgets,
      budget_digest_state,
      category_overrides,
      categories,
      merchants_canonical,
      accounts,
      user_alerts,
      smart_rules,
      rule_suggestions,
      insights,
      ledger_members,
      ledgers,
      access_users
      RESTART IDENTITY CASCADE
  `);
}

/**
 * Seed a bootstrap owner: access_users row + personal ledger + ledger_members.
 * Returns the owner's ledgerId (= telegramId for personal).
 */
export async function seedBootstrapOwner(telegramId: number): Promise<{ ledgerId: number }> {
  await sql.unsafe(`
    INSERT INTO access_users (telegram_user_id, first_name, role, status, ledger_user_id)
    VALUES (${telegramId}, 'Owner', 'owner', 'active', ${telegramId})
    ON CONFLICT (telegram_user_id) DO UPDATE
      SET role = 'owner', status = 'active', ledger_user_id = EXCLUDED.ledger_user_id,
          revoked_at = NULL, updated_at = NOW();
  `);
  await sql.unsafe(`
    INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
    VALUES (${telegramId}, ${telegramId}, 'Personal', 'personal')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    INSERT INTO ledger_members (ledger_id, telegram_user_id, role, status, can_view, can_add, can_manage)
    VALUES (${telegramId}, ${telegramId}, 'owner', 'active', TRUE, TRUE, TRUE)
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
      SET role = 'owner', status = 'active', can_view = TRUE, can_add = TRUE, can_manage = TRUE,
          revoked_at = NULL, updated_at = NOW();
  `);
  return { ledgerId: telegramId };
}

/**
 * Seed a household ledger for `ownerTelegramId` and add `memberTelegramId` as
 * an active member (role='member', can_view+can_add=TRUE, can_manage=FALSE).
 * Returns the household ledgerId (= -ownerTelegramId).
 */
export async function seedHouseholdWithMember(
  ownerTelegramId: number,
  memberTelegramId: number,
): Promise<{ householdLedgerId: number }> {
  const householdLedgerId = -Math.abs(ownerTelegramId);

  await sql.unsafe(`
    INSERT INTO access_users (telegram_user_id, first_name, role, status, ledger_user_id)
    VALUES (${memberTelegramId}, 'Member', 'member', 'active', ${memberTelegramId})
    ON CONFLICT (telegram_user_id) DO UPDATE
      SET role = 'member', status = 'active', ledger_user_id = EXCLUDED.ledger_user_id,
          revoked_at = NULL, updated_at = NOW();
  `);
  await sql.unsafe(`
    INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
    VALUES (${memberTelegramId}, ${memberTelegramId}, 'Personal', 'personal')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    INSERT INTO ledger_members (ledger_id, telegram_user_id, role, status, can_view, can_add, can_manage)
    VALUES (${memberTelegramId}, ${memberTelegramId}, 'owner', 'active', TRUE, TRUE, TRUE)
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
      SET role = 'owner', status = 'active', can_view = TRUE, can_add = TRUE, can_manage = TRUE,
          revoked_at = NULL, updated_at = NOW();
  `);

  await sql.unsafe(`
    INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
    VALUES (${householdLedgerId}, ${ownerTelegramId}, 'Household', 'household')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    INSERT INTO ledger_members (ledger_id, telegram_user_id, role, status, can_view, can_add, can_manage)
    VALUES (${householdLedgerId}, ${ownerTelegramId}, 'owner', 'active', TRUE, TRUE, TRUE)
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
      SET role = 'owner', status = 'active', can_view = TRUE, can_add = TRUE, can_manage = TRUE,
          revoked_at = NULL, updated_at = NOW();
  `);
  await sql.unsafe(`
    INSERT INTO ledger_members (ledger_id, telegram_user_id, role, status, can_view, can_add, can_manage)
    VALUES (${householdLedgerId}, ${memberTelegramId}, 'member', 'active', TRUE, TRUE, FALSE)
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
      SET role = 'member', status = 'active', can_view = TRUE, can_add = TRUE, can_manage = FALSE,
          revoked_at = NULL, updated_at = NOW();
  `);

  return { householdLedgerId };
}

/**
 * Seed a minimal category for a user and return its UUID.
 */
export async function seedCategory(userId: number, name = "Food"): Promise<string> {
  const rows = await sql.unsafe<Array<{ id: string }>>(
    `INSERT INTO categories (user_id, name)
     VALUES (${userId}, '${name.replace(/'/g, "''")}')
     RETURNING id`,
  );
  return rows[0]!.id;
}

/**
 * Seed a minimal account for a user and return its UUID.
 */
export async function seedAccount(userId: number, name = "Test Account"): Promise<string> {
  const rows = await sql.unsafe<Array<{ id: string }>>(
    `INSERT INTO accounts (user_id, name, type)
     VALUES (${userId}, '${name.replace(/'/g, "''")}', 'bank')
     RETURNING id`,
  );
  return rows[0]!.id;
}

/**
 * Insert a raw expense row directly (bypasses the audit-recording insertExpense helper).
 * Returns the new expense id.
 */
export async function insertRawExpense(params: {
  userId: number;
  amountCents: number;
  occurredAt: string; // ISO8601 or YYYY-MM-DD
  categoryId?: string | null;
  accountId?: string | null;
}): Promise<string> {
  const catSql = params.categoryId ? `'${params.categoryId}'` : "NULL";
  const accSql = params.accountId ? `'${params.accountId}'` : "NULL";
  const rows = await sql.unsafe<Array<{ id: string }>>(
    `INSERT INTO expenses (user_id, amount_cents, currency, description, source, occurred_at, category_id, account_id)
     VALUES (${params.userId}, ${params.amountCents}, 'INR', 'test expense', 'manual',
             '${params.occurredAt}'::timestamptz,
             ${catSql}, ${accSql})
     RETURNING id`,
  );
  return rows[0]!.id;
}

/**
 * Close a monthly period directly (bypasses the TS helper — pure SQL).
 */
export async function closeMonth(userId: number, periodMonth: string): Promise<void> {
  await sql.unsafe(`
    INSERT INTO monthly_closes (user_id, period_month, status, readiness_score, open_task_count, total_cents, transaction_count, snapshot)
    VALUES (${userId}, '${periodMonth}'::date, 'closed', 100, 0, 0, 0, '{}')
    ON CONFLICT (user_id, period_month) DO UPDATE
      SET status = 'closed', updated_at = NOW();
  `);
}

/**
 * Reopen a monthly period directly (pure SQL).
 */
export async function reopenMonth(userId: number, periodMonth: string): Promise<void> {
  await sql.unsafe(`
    UPDATE monthly_closes
    SET status = 'reopened', reopened_at = NOW(), updated_at = NOW()
    WHERE user_id = ${userId} AND period_month = '${periodMonth}'::date;
  `);
}

