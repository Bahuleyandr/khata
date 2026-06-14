# Backend Timezone → Asia/Kolkata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all backend date bucketing, range filtering, and "today/this month" logic evaluate in `Asia/Kolkata` (IST) instead of UTC, consistently across SQL and Node, without shifting any stored data.

**Architecture:** `occurred_at` is `TIMESTAMPTZ` and bot writes are noon-UTC anchored, so this is a *bucketing* fix, not a data migration. Two DB layers — a durable database default timezone (`ALTER DATABASE … SET timezone`) that corrects ~50 query sites at once, plus an **explicitly IST** rewrite of the month-close immutability trigger so the money-integrity guard is independent of session TZ. On the Node side, a small process-TZ-immune `lib/time.ts` feeds the few wall-clock-derived "now/today" inputs, with the pod `TZ` env as pure defense-in-depth.

**Tech Stack:** TypeScript, Fastify + grammy, postgres.js, PostgreSQL 16, vitest, Docker (native or WSL) for the real-Postgres smoke gate.

**Spec:** `docs/superpowers/specs/2026-06-14-backend-timezone-asia-kolkata-design.md`

**Branch:** `timezone-asia-kolkata` (already created off `main` @ `29ce798`; the spec is already committed here as `140ec58`).

**Conventions for every commit below:** end the commit message body with
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1: `lib/time.ts` — process-TZ-immune IST calendar helpers

**Files:**
- Create: `backend/src/lib/time.ts`
- Test: `backend/src/lib/time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { APP_TIME_ZONE, formatIstDate, monthStartString, nowIstParts, todayIst } from "./time.js";

describe("lib/time", () => {
  it("uses Asia/Kolkata", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Kolkata");
  });

  it("formatIstDate returns the IST calendar day for a late-UTC instant", () => {
    // 20:30Z on Jun 30 == 02:00 IST on Jul 1
    expect(formatIstDate(new Date("2026-06-30T20:30:00Z"))).toBe("2026-07-01");
  });

  it("formatIstDate is stable for a noon-UTC instant", () => {
    expect(formatIstDate(new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-01");
  });

  it("nowIstParts splits the IST day (1-based month)", () => {
    expect(nowIstParts(new Date("2026-06-30T20:30:00Z"))).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it("todayIst formats the given instant in IST", () => {
    expect(todayIst(new Date("2026-06-30T20:30:00Z"))).toBe("2026-07-01");
  });

  it("monthStartString rolls over year boundaries", () => {
    expect(monthStartString(2026, 6)).toBe("2026-06-01");
    expect(monthStartString(2026, 13)).toBe("2027-01-01");
    expect(monthStartString(2026, 0)).toBe("2025-12-01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Dev/Projects/khata/backend && npx vitest run src/lib/time.test.ts`
Expected: FAIL — `Failed to resolve import "./time.js"` / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/lib/time.ts`:

```ts
/**
 * Application timezone helpers.
 *
 * Khata is single-household and India-only, so the app timezone is a hardcoded
 * constant (India has no DST — a fixed +05:30). These helpers evaluate the
 * calendar day/month in IST via an explicit `timeZone`, so they are immune to
 * the Node process timezone — correctness does not depend on `TZ` on the pod.
 */
export const APP_TIME_ZONE = "Asia/Kolkata";

/** YYYY-MM-DD of an instant in IST. `en-CA` renders ISO-style YYYY-MM-DD. */
export function formatIstDate(instant: Date): string {
  return instant.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** Today's date as YYYY-MM-DD in IST. */
export function todayIst(now: Date = new Date()): string {
  return formatIstDate(now);
}

/** Current IST calendar parts (1-based month). */
export function nowIstParts(now: Date = new Date()): { year: number; month: number; day: number } {
  const [year, month, day] = formatIstDate(now).split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * First day (`YYYY-MM-01`) of a 1-based month, rolling the year when month1 < 1
 * or > 12 (e.g. `monthStartString(2026, 13)` → "2027-01-01"). Used for IST
 * month-window bounds.
 */
export function monthStartString(year: number, month1: number): string {
  const total = year * 12 + (month1 - 1);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/Dev/Projects/khata/backend && npx vitest run src/lib/time.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: (robustness) Prove process-TZ immunity**

Run (PowerShell, from `D:/Dev/Projects/khata/backend`):
`$env:TZ='America/New_York'; npx vitest run src/lib/time.test.ts; Remove-Item Env:TZ`
Expected: PASS (identical results — the helpers ignore process TZ).

- [ ] **Step 6: Commit**

```bash
git -C D:/Dev/Projects/khata add backend/src/lib/time.ts backend/src/lib/time.test.ts
git -C D:/Dev/Projects/khata commit -m "feat(time): IST calendar helpers (process-TZ-immune)"
```

---

## Task 2: Migration 027 — DB default timezone + IST close trigger + pool TimeZone

**Files:**
- Create: `backend/src/db/migrations/027_timezone_asia_kolkata.sql`
- Modify: `backend/src/db/index.ts`
- Modify: `backend/src/db/migrate.ts:15`
- Modify: `scripts/migration-smoke.mjs` (add assertion + call)

This task is gated by the real-Postgres **migration smoke** (the unit suite mocks `sql`, so the trigger can only be proven against a real DB).

- [ ] **Step 1: Write the failing smoke assertion**

In `scripts/migration-smoke.mjs`, add this function immediately after the existing `assertMonthCloseImmutability` function (before `async function main()`):

```js
/**
 * Migration 027: the database default timezone must be Asia/Kolkata, and the
 * close trigger must bucket occurred_at in IST (not the session TZ). The
 * boundary instant 2026-06-30T20:30:00Z == 2026-07-01 02:00 IST must be treated
 * as JULY: closing June must NOT block it, closing July MUST block it.
 */
async function assertTimezoneBucketing() {
  console.log("Verifying timezone default + IST month bucketing...");

  const tz = await psql("SHOW timezone");
  if (tz !== "Asia/Kolkata") {
    throw new Error(`Expected DB default timezone Asia/Kolkata, got '${tz}'`);
  }

  await psql(
    "INSERT INTO expenses (user_id, amount_cents, occurred_at) VALUES (998, 10000, '2026-06-30T20:30:00Z')",
  );

  // Closing JUNE must NOT block it (the expense is July in IST).
  await psql(
    "INSERT INTO monthly_closes (user_id, period_month, status) VALUES (998, '2026-06-01', 'closed')",
  );
  await psql("UPDATE expenses SET amount_cents = 10001 WHERE user_id = 998");
  const afterJune = await psql("SELECT amount_cents FROM expenses WHERE user_id = 998");
  if (afterJune !== "10001") {
    throw new Error(`June close wrongly blocked a July-IST expense (got ${afterJune})`);
  }

  // Closing JULY must block it.
  await psql(
    "INSERT INTO monthly_closes (user_id, period_month, status) VALUES (998, '2026-07-01', 'closed')",
  );
  const out = await psql("UPDATE expenses SET amount_cents = 20000 WHERE user_id = 998", {
    expectError: true,
  });
  if (!/KHATA_MONTH_CLOSED/.test(out)) {
    throw new Error("July close did NOT block a July-IST boundary expense");
  }

  console.log("Timezone default + IST bucketing verified.");
}
```

Then in `main()`, add the call right after the existing `await assertMonthCloseImmutability();` line:

```js
  await assertMonthCloseImmutability();
  await assertTimezoneBucketing();
```

- [ ] **Step 2: Run the smoke to verify it fails**

Run: `cd D:/Dev/Projects/khata && node scripts/migration-smoke.mjs`
Expected: FAIL — `Expected DB default timezone Asia/Kolkata, got 'UTC'` (the `postgres:16-alpine` default is UTC and migration 027 does not exist yet).
Note: requires Docker; the script auto-detects native `docker` and falls back to `wsl docker`. Takes a few minutes (spins a disposable container + runs all migrations).

- [ ] **Step 3: Create migration 027**

Create `backend/src/db/migrations/027_timezone_asia_kolkata.sql`:

```sql
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
```

- [ ] **Step 4: Set the session timezone on the app pool**

Replace the whole body of `backend/src/db/index.ts` with:

```ts
import postgres from "postgres";
import { config } from "../config.js";

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // India-only app: evaluate date_trunc / ::date / CURRENT_DATE in IST. The
  // authoritative default is migration 027 (ALTER DATABASE); pinning it on the
  // pool makes the intent explicit and covers a fresh DB before that migration
  // has run. If a postgres.js version ignores this option the migrated DB
  // default still applies.
  connection: { timezone: "Asia/Kolkata" },
});
```

- [ ] **Step 5: Set the session timezone on the migration-runner pool**

In `backend/src/db/migrate.ts`, change line 15 from:

```ts
  const sql = postgres(config.databaseUrl);
```

to:

```ts
  const sql = postgres(config.databaseUrl, { connection: { timezone: "Asia/Kolkata" } });
```

- [ ] **Step 6: Run the smoke to verify it passes**

Run: `cd D:/Dev/Projects/khata && node scripts/migration-smoke.mjs`
Expected: PASS — both `Month-close immutability trigger verified.` and `Timezone default + IST bucketing verified.`, ending `Migration smoke passed.`

- [ ] **Step 7: Commit**

```bash
git -C D:/Dev/Projects/khata add backend/src/db/migrations/027_timezone_asia_kolkata.sql backend/src/db/index.ts backend/src/db/migrate.ts scripts/migration-smoke.mjs
git -C D:/Dev/Projects/khata commit -m "feat(tz): default DB timezone to Asia/Kolkata + IST close trigger (migration 027)"
```

---

## Task 3: `budgets.ts` — bucket MTD spend in IST

**Files:**
- Modify: `backend/src/db/budgets.ts:72`

No unit test asserts this SQL (`cron/budgets.test.ts` mocks `getBudgetsWithMtd` entirely; the unit suite mocks `sql`). The behavioral guarantee is the real-Postgres check in **Task 6**, which calls `getBudgetsWithMtd` against a live DB.

- [ ] **Step 1: Change the budget MTD bucket to IST**

In `backend/src/db/budgets.ts`, change line 72 from:

```ts
      AND TO_CHAR(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = ${yearMonth}
```

to:

```ts
      AND TO_CHAR(e.occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = ${yearMonth}
```

- [ ] **Step 2: Confirm the unit suite stays green**

Run: `cd D:/Dev/Projects/khata/backend && npx vitest run src/cron/budgets.test.ts`
Expected: PASS (the mock is unaffected).

- [ ] **Step 3: Commit**

```bash
git -C D:/Dev/Projects/khata add backend/src/db/budgets.ts
git -C D:/Dev/Projects/khata commit -m "fix(tz): bucket budget MTD spend in Asia/Kolkata"
```

---

## Task 4: `insights/compute.ts` — IST month windows

**Files:**
- Modify: `backend/src/insights/compute.ts`

The month-bound helpers currently build **UTC-midnight `Date` instants** and pass them directly as `occurred_at` bounds (shifted under an IST session). Convert them to IST `YYYY-MM-01` strings and the standard `::date` half-open window. The pure rollover logic is already covered by `monthStartString` tests (Task 1); the live behavior is covered by Task 6.

- [ ] **Step 1: Add the import**

At the top of `backend/src/insights/compute.ts`, add:

```ts
import { nowIstParts, monthStartString } from "../lib/time.js";
```

- [ ] **Step 2: Replace the MonthRange type and the two bound helpers**

Replace this block (lines ~44–61):

```ts
interface MonthRange {
  start: Date;
  end: Date;
}

function thisMonthBoundsUtc(now: Date = new Date()): MonthRange {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function lastMonthBoundsUtc(now: Date = new Date()): MonthRange {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}
```

with:

```ts
interface MonthRange {
  start: string; // YYYY-MM-01 inclusive
  end: string;   // YYYY-MM-01 exclusive (first of next month)
}

function thisMonthBoundsIst(now: Date = new Date()): MonthRange {
  const { year, month } = nowIstParts(now);
  return { start: monthStartString(year, month), end: monthStartString(year, month + 1) };
}

function lastMonthBoundsIst(now: Date = new Date()): MonthRange {
  const { year, month } = nowIstParts(now);
  return { start: monthStartString(year, month - 1), end: monthStartString(year, month) };
}
```

- [ ] **Step 3: Update the two call sites**

In `computeMtdVsLastMonth` (lines ~69–70), change:

```ts
  const mtd = thisMonthBoundsUtc();
  const last = lastMonthBoundsUtc();
```

to:

```ts
  const mtd = thisMonthBoundsIst();
  const last = lastMonthBoundsIst();
```

- [ ] **Step 4: Coerce the string bounds to dates in the four queries**

The bounds are now strings, so add `::date` to every comparison. Apply these four replacements across the four queries in `computeMtdVsLastMonth` (each pattern occurs twice — use replace-all):

- `occurred_at >= ${mtd.start}` → `occurred_at >= ${mtd.start}::date`
- `occurred_at < ${mtd.end}` → `occurred_at < ${mtd.end}::date`
- `occurred_at >= ${last.start}` → `occurred_at >= ${last.start}::date`
- `occurred_at < ${last.end}` → `occurred_at < ${last.end}::date`

(The `e.occurred_at >= ${mtd.start}` variants in the category queries are the same text after the `e.` table alias — confirm all eight references now end with `::date`.)

- [ ] **Step 5: Typecheck + unit suite green**

Run: `cd D:/Dev/Projects/khata/backend && npx tsc -p tsconfig.json && npx vitest run`
Expected: PASS — no type errors (MonthRange is now strings end-to-end), full suite green.

- [ ] **Step 6: Commit**

```bash
git -C D:/Dev/Projects/khata add backend/src/insights/compute.ts
git -C D:/Dev/Projects/khata commit -m "fix(tz): compute insights month windows in Asia/Kolkata"
```

---

## Task 5: Wire the Node "now/today" inputs through IST helpers

**Files:**
- Modify: `backend/src/bot/handlers.ts` (import; `todayString`; `parseCommandPeriod`; three display formatters)
- Modify: `backend/src/routes/expenses.ts` (import; `selectedMonth`; `monthProgress`)
- Modify: `backend/src/routes/monthly-review.ts` (import; query-month resolver; `monthProgress`)

These are mechanical swaps of already-tested helpers (Task 1). The wiring is verified by keeping the existing unit suites green and by the Task 6 end-to-end check. The stored noon-UTC anchor on `occurred_at` is **left unchanged**.

- [ ] **Step 1: handlers.ts — import + `todayString` + `parseCommandPeriod`**

Add the import after `import { sql } from "../db/index.js";` (line 7) — all three helpers are used by the end of this task:

```ts
import { todayIst, nowIstParts, formatIstDate } from "../lib/time.js";
```

Change `todayString` (lines 86–88) from:

```ts
function todayString(): string {
  return new Date().toISOString().split("T")[0]!;
}
```

to:

```ts
function todayString(): string {
  return todayIst();
}
```

In `parseCommandPeriod` (line 124), change:

```ts
  const current = currentMonthBounds(now.getFullYear(), now.getMonth() + 1);
```

to:

```ts
  const { year: nowYear, month: nowMonth } = nowIstParts(now);
  const current = currentMonthBounds(nowYear, nowMonth);
```

- [ ] **Step 2: handlers.ts — IST display formatters (the safe tail)**

These display noon-anchored `occurred_at`, so they are correct today; switch them to IST for consistency and to fix the non-noon-anchored edge cases (UPI same-day, statement `DATE`). `formatIstDate` was already imported in Step 1. (Line numbers below are pre-edit guidance; match on the string content.)

Two of the three lines are **byte-identical** (around lines 978 and 1045), so edit them with `replace_all` — both become the same call:

`const date = new Date(row.occurred_at).toISOString().slice(0, 10);`
→ `const date = formatIstDate(new Date(row.occurred_at));`  *(replace_all — changes both occurrences)*

The third is distinct (around line 1135 — note `r.` and `.split`):

`const date = new Date(r.occurred_at).toISOString().split("T")[0]!;`
→ `const date = formatIstDate(new Date(r.occurred_at));`

Leave the bespoke "DD Mon" formatter around lines 863–865 as-is (it is noon-anchored and correct; reformatting it in IST is out of scope and risk-for-no-gain).

- [ ] **Step 3: expenses.ts — import + `selectedMonth` + `monthProgress`**

Add the import after `import { currentMonthBounds } from "../export/xlsx.js";` (line 13):

```ts
import { nowIstParts } from "../lib/time.js";
```

Replace `selectedMonth` (lines 316–322) with:

```ts
function selectedMonth(query: SummaryQuery): { year: number; month: number } {
  const { year, month } = nowIstParts();
  return {
    year: query.year ?? year,
    month: query.month ?? month,
  };
}
```

Replace `monthProgress` (lines 324–332) with:

```ts
function monthProgress(year: number, month: number): { elapsedDays: number; daysInMonth: number } {
  const { year: nowYear, month: nowMonth, day: nowDay } = nowIstParts();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrentMonth = nowYear === year && nowMonth === month;
  return {
    elapsedDays: isCurrentMonth ? Math.max(1, Math.min(nowDay, daysInMonth)) : daysInMonth,
    daysInMonth,
  };
}
```

- [ ] **Step 4: monthly-review.ts — import + query-month resolver + `monthProgress`**

Add the import after `import { currentMonthBounds } from "../export/xlsx.js";` (line 14):

```ts
import { nowIstParts } from "../lib/time.js";
```

The query-month resolver ends at line 114 with the same shape as `selectedMonth`. Change its body (the `const now = new Date();` line and the return block, ~lines 109–113) from:

```ts
  const now = new Date();
  return {
    year: query.year ?? now.getFullYear(),
    month: query.month ?? now.getMonth() + 1,
  };
```

to:

```ts
  const { year, month } = nowIstParts();
  return {
    year: query.year ?? year,
    month: query.month ?? month,
  };
```

Replace `monthProgress` (lines 116–124) with the identical IST version:

```ts
function monthProgress(year: number, month: number): { elapsedDays: number; daysInMonth: number } {
  const { year: nowYear, month: nowMonth, day: nowDay } = nowIstParts();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrentMonth = nowYear === year && nowMonth === month;
  return {
    elapsedDays: isCurrentMonth ? Math.max(1, Math.min(nowDay, daysInMonth)) : daysInMonth,
    daysInMonth,
  };
}
```

- [ ] **Step 5: Typecheck + full backend unit suite green (incl. handlers.test.ts)**

Run: `cd D:/Dev/Projects/khata/backend && npx tsc -p tsconfig.json && npx vitest run`
Expected: PASS — full suite green, `src/bot/handlers.test.ts` included (it mocks `currentMonthBounds`/`sql`/`config` but not `lib/time`, so the real pure helpers run; no boundary-crossing fixed clock is used, so behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git -C D:/Dev/Projects/khata add backend/src/bot/handlers.ts backend/src/routes/expenses.ts backend/src/routes/monthly-review.ts
git -C D:/Dev/Projects/khata commit -m "fix(tz): derive Node now/today inputs + date display in Asia/Kolkata"
```

---

## Task 6: Real-Postgres end-to-end verification (throwaway, not committed)

**Files:**
- Create (temporary): `backend/__verify_tz.ts` — **delete before finishing; never commit.**

Exercises the actual TS code paths through the **app pool** (proving the pool TimeZone *and* the `budgets.ts` change) plus the trigger, against a live Postgres. This is the memory-mandated real-PG check for money-adjacent changes.

- [ ] **Step 1: Start a disposable Postgres and apply migrations**

PowerShell (native Docker; if it fails, prefix `wsl ` before `docker`):

```powershell
docker run -d --rm --name khata-tzverify -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=khata_tz -p 127.0.0.1:55439:5432 postgres:16-alpine
# wait ~5s for readiness, then apply migrations:
$env:DATABASE_URL='postgres://postgres@127.0.0.1:55439/khata_tz'
$env:TELEGRAM_BOT_TOKEN='t'; $env:ALLOWED_TELEGRAM_USER_IDS='1'; $env:SESSION_SECRET='test-secret-that-is-at-least-32-chars-long'; $env:MINIMAX_API_KEY='k'; $env:S3_ENDPOINT='http://localhost:9000'; $env:S3_BUCKET='b'; $env:S3_REGION='us-east-1'; $env:S3_ACCESS_KEY_ID='a'; $env:S3_SECRET_ACCESS_KEY='s'
npm --prefix backend run migrate:dev
```

(If using WSL docker, the mapped port works at `127.0.0.1:55439` from Windows.)

- [ ] **Step 2: Write the verification script**

Create `backend/__verify_tz.ts`:

```ts
import postgres from "postgres";
import { getBudgetsWithMtd } from "./src/db/budgets.js";

const sql = postgres(process.env.DATABASE_URL!, { connection: { timezone: "Asia/Kolkata" } });
let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) failures++;
}

const USER = 990001;
const BOUNDARY = "2026-06-30T20:30:00Z"; // == 2026-07-01 02:00 IST

await sql`DELETE FROM expenses WHERE user_id = ${USER}`;
await sql`DELETE FROM monthly_closes WHERE user_id = ${USER}`;
await sql`DELETE FROM category_budgets WHERE user_id = ${USER}`;
await sql`DELETE FROM categories WHERE user_id = ${USER}`;

const [{ tz }] = await sql<{ tz: string }[]>`SELECT current_setting('timezone') AS tz`;
check(tz === "Asia/Kolkata", `pool session timezone is IST (got ${tz})`);

const [cat] = await sql<{ id: string }[]>`
  INSERT INTO categories (user_id, name) VALUES (${USER}, 'TZ Test') RETURNING id`;
await sql`
  INSERT INTO category_budgets (user_id, category_id, target_cents)
  VALUES (${USER}, ${cat.id}, 100000)`;
await sql`
  INSERT INTO expenses (user_id, amount_cents, category_id, occurred_at)
  VALUES (${USER}, 12345, ${cat.id}, ${BOUNDARY})`;

const july = await getBudgetsWithMtd(USER, "2026-07");
const june = await getBudgetsWithMtd(USER, "2026-06");
check(july[0]?.spent_cents === 12345, `budgets: boundary expense counts in JULY (got ${july[0]?.spent_cents})`);
check(june[0]?.spent_cents === 0, `budgets: boundary expense NOT in JUNE (got ${june[0]?.spent_cents})`);

const [jWin] = await sql`
  SELECT COUNT(*)::int AS n FROM expenses
  WHERE user_id = ${USER} AND occurred_at >= '2026-07-01'::date AND occurred_at < '2026-08-01'::date`;
const [juWin] = await sql`
  SELECT COUNT(*)::int AS n FROM expenses
  WHERE user_id = ${USER} AND occurred_at >= '2026-06-01'::date AND occurred_at < '2026-07-01'::date`;
check(jWin.n === 1, `summary window: boundary expense in JULY range (n=${jWin.n})`);
check(juWin.n === 0, `summary window: boundary expense NOT in JUNE range (n=${juWin.n})`);

await sql`INSERT INTO monthly_closes (user_id, period_month, status) VALUES (${USER}, '2026-07-01', 'closed')`;
let blocked = false;
try {
  await sql`UPDATE expenses SET amount_cents = 1 WHERE user_id = ${USER}`;
} catch (err) {
  blocked = /KHATA_MONTH_CLOSED/.test(String(err));
}
check(blocked, "trigger: July close blocks edit to the boundary (July-IST) expense");

await sql`DELETE FROM monthly_closes WHERE user_id = ${USER}`;
await sql`DELETE FROM expenses WHERE user_id = ${USER}`;
await sql`DELETE FROM category_budgets WHERE user_id = ${USER}`;
await sql`DELETE FROM categories WHERE user_id = ${USER}`;
await sql.end();

console.log(failures === 0 ? "\nALL TIMEZONE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Run the verification**

Run (same shell, `DATABASE_URL` still set): `cd D:/Dev/Projects/khata && npx tsx backend/__verify_tz.ts`
Expected: all `ok` lines and `ALL TIMEZONE CHECKS PASSED`.

- [ ] **Step 4: Tear down + delete the script**

```powershell
docker rm -f khata-tzverify   # or: wsl docker rm -f khata-tzverify
Remove-Item D:/Dev/Projects/khata/backend/__verify_tz.ts
```

Confirm it is gone: `git -C D:/Dev/Projects/khata status --short` shows no `__verify_tz.ts`. (No commit — this task produces no committed artifact.)

---

## Task 7: Pin pod timezone (defense-in-depth)

**Files:**
- Modify: `deploy/k8s/30-backend.yaml`

- [ ] **Step 1: Add the `TZ` env var**

In `deploy/k8s/30-backend.yaml`, in the backend container's `env:` list, add this entry immediately after the `PORT` entry (after line 45):

```yaml
            - name: TZ
              value: Asia/Kolkata
```

- [ ] **Step 2: Sanity-check the YAML parses**

Run: `cd D:/Dev/Projects/khata && node -e "const f=require('fs').readFileSync('deploy/k8s/30-backend.yaml','utf8'); if(!/name:\s*TZ/.test(f)||!/Asia\/Kolkata/.test(f)) process.exit(1); console.log('TZ env present')"`
Expected: prints `TZ env present`.
(`kubectl` runs on Dalekdefender, not locally; the manifest is inert until the held deploy applies it.)

- [ ] **Step 3: Commit**

```bash
git -C D:/Dev/Projects/khata add deploy/k8s/30-backend.yaml
git -C D:/Dev/Projects/khata commit -m "chore(tz): pin backend pod TZ=Asia/Kolkata (defense-in-depth)"
```

---

## Task 8: Full verification + finish the branch

- [ ] **Step 1: Backend typecheck + unit suite**

Run: `cd D:/Dev/Projects/khata/backend && npx tsc -p tsconfig.json && npx vitest run`
Expected: PASS — prior 213 tests + the new `lib/time` tests (≈219), all green.

- [ ] **Step 2: Frontend unit suite + build**

Run: `cd D:/Dev/Projects/khata && npx vitest run`
Expected: PASS — 12 tests (unchanged; the frontend was already fixed via `lib/dates`).
Run: `cd D:/Dev/Projects/khata && npm run build`
Expected: Next build succeeds.

- [ ] **Step 3: Premerge gate (authoritative — runs lint, suites, build, and the migration smoke)**

Run: `cd D:/Dev/Projects/khata && npm run premerge`
Expected: green, including the migration smoke with the new IST assertion. Needs Docker (native or WSL fallback).

- [ ] **Step 4: Merge to main, push both remotes, prune**

```bash
git -C D:/Dev/Projects/khata switch main
git -C D:/Dev/Projects/khata merge --no-ff timezone-asia-kolkata -m "Merge: backend timezone → Asia/Kolkata (bucketing fix, no data shift)"
KHATA_ALLOW_MAIN_PUSH=1 git -C D:/Dev/Projects/khata push origin main
KHATA_ALLOW_MAIN_PUSH=1 git -C D:/Dev/Projects/khata push forgejo main
git -C D:/Dev/Projects/khata branch -d timezone-asia-kolkata
```

Expected: both pushes succeed; local branch deleted. **Deploy stays HELD** — 027 will run with 025/026 when the user un-holds.

- [ ] **Step 5: Update project memory**

Append to the Khata resume memory that the timezone item is shipped (fix #16): migration 027 (DB default IST + explicit-IST close trigger), `lib/time.ts`, budgets/insights IST, Node inputs IST, pod `TZ` env; smoke extended with the IST boundary assertion; deploy still held.

---

## Notes for the executor

- **Docker:** native Docker Desktop may be down; the smoke auto-falls back to `wsl docker`, and Task 6 can prefix `wsl ` before `docker`. Ports are reachable from Windows at `127.0.0.1`.
- **Main-push hook:** direct pushes to `main` require `KHATA_ALLOW_MAIN_PUSH=1` on **both** remotes (sanctioned override).
- **Do not change** the noon-UTC anchor on stored `occurred_at`, and do not touch `statement_rows.occurred_at` (`DATE`) semantics.
- **`__verify_tz.ts` must not be committed** — it is deleted in Task 6 Step 4.
- Task 6 seeds a `categories` row with `(user_id, name)` only; if that table has additional NOT NULL columns without defaults, extend the INSERT (or fall back to a raw `TO_CHAR(occurred_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM')` check to prove the budgets bucket).
