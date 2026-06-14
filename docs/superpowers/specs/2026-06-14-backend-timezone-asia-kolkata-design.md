# Backend Timezone → Asia/Kolkata — Design

- **Date:** 2026-06-14
- **Status:** Design approved; pending spec review
- **Branch:** `timezone-asia-kolkata`
- **Scope chosen by user:** Complete pass — DB **and** Node side.

## Problem

Khata is India-first; the owner and his wife think in IST (`Asia/Kolkata`,
UTC+05:30, no DST). The backend pods set no timezone, so Postgres evaluates all
date logic in **UTC** and Node's `Date` math runs in UTC. Near month/day
boundaries this puts transactions in the wrong bucket.

Root cause: `expenses.occurred_at` is `TIMESTAMPTZ` (migration 001), so the
stored **instants are already correct**. The wrongness is entirely in how those
instants are *evaluated*:

- ~50 query sites filter with
  `occurred_at >= ${start}::date AND occurred_at < (${end}::date + INTERVAL '1 day')`.
  Coercing a `date` to compare against `timestamptz` uses the **session TimeZone**,
  so the "June" window is silently `[Jun 1 00:00 UTC … Jul 1 00:00 UTC)` — shifted
  −5:30 from what the user means.
- `date_trunc` / `::date` / `CURRENT_DATE` / `to_char(NOW())` are session-TZ
  sensitive too. This includes the **month-close immutability trigger** (migration
  025), `alerts.ts`, and the nightly-nudge "logged today" check.
- `budgets.ts:72` hard-codes `AT TIME ZONE 'UTC'`.
- Node derives "today"/"this month" from the UTC wall clock in a few input paths.

The most dangerous symptom: the 025 trigger can bucket a boundary expense into a
*different* month than the summary the user signed off on, so the immutability
guard and the close UI disagree.

## Key invariant — why this is a correctness fix, not a data migration

1. `occurred_at` is `timestamptz` ⇒ stored instants are correct; nothing to backfill.
2. Bot, dashboard-manual, manual-edit, and UPI writes store `occurred_at`
   **noon-UTC anchored** (`new Date(parsed.occurred_at + "T12:00:00Z")`, etc.).
   Noon-UTC lands on the **same calendar day in both UTC and IST**, so flipping the
   session TZ shifts **no** bot-entered expense's day or month.
3. Therefore the change only moves the **boundary window** from `[…00:00 UTC)` to
   `[…00:00 IST)` — the correct, user-meant window.
4. It ships in the **same held batch as migration 025**, so 025's trigger goes live
   already IST-correct. There is no "regime change" on already-closed production
   data (none exists — 025 is not deployed yet).

## Goals

- All month/day bucketing, range filtering, and "today"/"this month" logic evaluate
  in `Asia/Kolkata`, consistently across SQL and Node.
- The 025 close trigger buckets in IST **and is independent of session TZ** (defends
  the money-integrity guard even from a stray non-IST session).
- No shift of existing stored data; no backfill.
- Verified end-to-end against **real Postgres** (the unit suite mocks `sql`, so a
  column/TZ mistake passes unit tests but breaks behavior).

## Non-goals

- Per-user timezones. Single household, single region → one hardcoded constant
  `APP_TIME_ZONE = 'Asia/Kolkata'`.
- Changing the noon-UTC anchor storage convention (it is deliberate and TZ-robust).
- Changing `statement_rows.occurred_at` (a plain `DATE`) semantics.

## Design

### 1. DB default timezone — new migration `027_timezone_asia_kolkata.sql`

- Set a **durable, client-agnostic default** on the database. Migrations are static
  `.sql` run by `migrate.ts`, which cannot know the DB name, so use a `DO` block:

  ```sql
  DO $$
  BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'Asia/Kolkata');
  END
  $$;
  ```

  This applies to every **new** connection: app pool, `migrate.ts`, cron, manual psql.

- Also set the session TZ **explicitly on both postgres.js pools**
  (`db/index.ts`, `db/migrate.ts`) so fresh local/test DBs and the current process
  are correct immediately — not only after the `ALTER` takes effect on reconnect, and
  so the intent is visible in code. Exact postgres.js incantation is verified against a
  real container (assert `SHOW TimeZone` = `Asia/Kolkata`); fallback is the
  connection-string `options=-c timezone=Asia/Kolkata`.

### 2. Close-immutability trigger — rewrite in `027`

`CREATE OR REPLACE FUNCTION khata_assert_month_open()` with all three bucketing
expressions changed:

```
date_trunc('month', NEW.occurred_at)::date
→ date_trunc('month', NEW.occurred_at AT TIME ZONE 'Asia/Kolkata')::date
```

(and the two `OLD.occurred_at` sites). The trigger declaration itself is unchanged
(it already covers `INSERT/UPDATE/DELETE`). The function is now **session-TZ
independent** and matches the user-picked `period_month` and the IST summary window
exactly.

> Consistency proof: the summary uses `currentMonthBounds(year, month)` →
> `[Jun-1 00:00 IST, Jul-1 00:00 IST)` under the IST session; the trigger buckets by
> IST month = the same window; `period_month` is the user-picked `YYYY-MM-01`. All
> three agree iff the app session is IST **and** the trigger is IST — hence both
> changes are required.

### 3. `budgets.ts:72`

`TO_CHAR(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM')` → `AT TIME ZONE 'Asia/Kolkata'`
(explicit, matches the trigger).

### 4. `insights/compute.ts`

`thisMonthBoundsUtc` / `lastMonthBoundsUtc` build **UTC-midnight `Date` instants** and
pass them as query bounds → they shift under an IST session. Convert to IST month
bounds (compute IST parts, or pass `year`/`month` and bucket in SQL with the standard
`>= start::date AND < (end::date + 1 day)` pattern under the IST session). Confirm
during impl that this is the **only** JS site passing UTC-midnight instants as query
bounds.

### 5. Node side

- New `backend/src/lib/time.ts`:
  - `export const APP_TIME_ZONE = 'Asia/Kolkata'`
  - `todayIst(): string` — `YYYY-MM-DD` in IST (`toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE })` or `Intl.DateTimeFormat` parts). **Immune to process TZ.**
  - `formatIstDate(instant: Date): string` — `YYYY-MM-DD` of an instant in IST.
  - `nowIstParts(): { year: number; month: number; day: number }` — current IST
    calendar parts, for "which month is it now" defaults. **Immune to process TZ.**
- Route `todayString()` (`handlers.ts:86`) → `todayIst()`. This is the **LLM "today"
  reference** for relative-date parsing ("yesterday") — highest-value Node fix.
- Route the `new Date()`-local-parts sites through `nowIstParts()` so they are correct
  regardless of process TZ: `monthProgress` (`routes/expenses.ts:324`,
  `routes/monthly-review.ts:116`), `parseCommandPeriod` (`bot/handlers.ts:122`), and the
  `selectedMonth` query default.
- **Keep the noon-UTC anchor on stored `occurred_at` unchanged** — do *not* switch to
  local midnight.
- Pin `TZ=Asia/Kolkata` on the backend Deployment as **pure defense-in-depth** (covers
  anything missed and third-party `Date` use) — with the input logic already routed
  through explicit IST helpers, the env var is **not** the sole guarantee of correctness.
- Display formatters that hard-code `timeZone:"UTC"` / `getUTCDate()` /
  `toISOString().slice(0,10)` (`handlers.ts:864-865, 978, 1045, 1135`) →
  `formatIstDate`. **Display-only and protected by the noon anchor**, so this is the
  safe tail; included for consistency and to fix the non-noon-anchored edge cases
  (UPI same-day fallback, statement `DATE` rows).

### Sites confirmed TZ-safe (no change)

- The JS `monthBounds` helpers in `reconciliation.ts:48-51` and `settlements.ts:32-35`
  produce month-boundary **strings** via
  `new Date(Date.UTC(year, month, 0)).toISOString().slice(0,10)` from explicit
  `year`/`month` args = pure calendar arithmetic, TZ-independent.
  (Their SQL range filters — `reconciliation.ts:71-72`, `settlements.ts:59-60` — *are*
  TZ-sensitive but are corrected by the global session-TZ lever in §1, like every other
  `occurred_at >= start::date` site; no per-file edit needed.)

## Testing strategy

Real-Postgres E2E is mandatory here (the unit suite mocks `sql`).

- **Real-Postgres E2E** (throwaway `backend/__verify_tz.ts` via `npx tsx`, or a vitest
  integration test against a `wsl docker run postgres:16-alpine` container):
  - Assert `SHOW TimeZone` = `Asia/Kolkata` on a fresh pool connection (and after the
    027 `ALTER DATABASE`).
  - Seed a boundary expense at `2026-07-01 02:00 IST` (= `2026-06-30 20:30 UTC`).
    Assert it buckets as **July** in: monthly-review summary, `budgets` MTD, `alerts`
    current-month, and the dashboard date range.
  - Close July → editing / deleting / inserting that row raises
    `KHATA_MONTH_CLOSED`; reopen → edit → reclose succeeds.
- **Unit:** `lib/time.ts` (run the suite under `TZ=America/New_York` to prove process-TZ
  immunity); `monthProgress` / bounds helpers.
- **Migration smoke:** extend `migration-smoke.mjs` (which already asserts the 025
  trigger behaviorally) with the IST boundary assertion.

## Deploy coordination

- Lands in the **held batch** with 025/026 — no separate deploy.
- Verify locally: `cd backend && npx tsc -p tsconfig.json && npx vitest run` (213),
  root `npx vitest run` (12) + `npm run build`; then `npm run premerge` green.
- Per change: TDD (RED→GREEN). Merge `--no-ff`; push **both** remotes with
  `KHATA_ALLOW_MAIN_PUSH=1`; prune the branch.
- When the user un-holds: 027 runs alongside 025/026
  (`kubectl exec -n khata deploy/khata-backend -- node dist/db/migrate.js`).

## Risks & mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | postgres.js session-TZ option naming uncertain | Verify `SHOW TimeZone` against a real container during TDD; fall back to `options=-c timezone=Asia/Kolkata` on the connection string. |
| R2 | `ALTER DATABASE` needs the DB name in a static `.sql` | `DO` block with `current_database()` + `format()`. |
| R3 | Pinning pod `TZ` shifts code that assumed UTC `new Date()` parts | Audited: only `monthProgress` / `parseCommandPeriod` / `selectedMonth` use local parts (all should be IST). Explicit-UTC code (`Date.UTC`, `getUTC*`, `toISOString`) is immune and intentional. `insights/compute` is the one to convert. |
| R4 | Summary ↔ trigger disagree at the boundary | Both use the IST month window; proven equivalent; E2E covers it. |
| R5 | Existing closed months under the old (UTC) regime | None in prod (025 not live); 027 ships with 025. |

## Open questions

None blocking. The only thing to confirm empirically is the postgres.js
session-timezone incantation (R1), which the TDD real-PG step proves.
