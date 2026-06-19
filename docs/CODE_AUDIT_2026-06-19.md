# Khata — Consolidated Code Audit (2026-06-19)

**Repo:** `D:\Dev\Projects\khata` @ `main` (46021dd), working tree clean.
**Scope:** full sweep — ~24.5K LOC backend TS, ~8.7K LOC frontend, 32 SQL migrations, deploy manifests, CI, scripts.
**Method:** two independent audits, reconciled here.
- **Audit A (internal):** 8 parallel specialist auditors (auth/access · money-path · DB/migrations · capture-AI · routes/bot · cron/ops · frontend · infra/CI), each a line-by-line read, with the highest-stakes findings manually re-verified against source.
- **Audit B (external):** a read-only sweep across source/tests/scripts/deploy that also *executed* the local gates (lint, unit, build, e2e, premerge, integration, migration-smoke).
- **Decision support:** three design-dependent findings were run through an advocate/challenger/supervisor `[DECIDE]` trio; outcomes in §5.

**Status:** remediation in progress on branch `fix/audit-2026-06-19`. **Landed (TDD, backend verify 295/295):** the two Now items (M2 `npm audit fix`, M3 smoke stderr), **H4** (owner revocation), **H2** (paid_by self-attribution), **M1** (receipt ordering/415/cleanup), **D1** (CSRF tradeoff documented), **D2** (review-status in live totals + confirmed-only close, resolves H1), **D3** (statement→MiniMax disclosure, resolves H6 for the current threat model). **H5 withdrawn** as a false positive (§3). Remaining: PR 3 reliability/DB hardening (H3, H7, M4–M11) + ops/infra (M13–M15) — not yet started.

---

## 1. Verdict — **B / B−**

Genuinely well-engineered and clearly hardened by prior review sprints: ledger isolation is consistent (`WHERE user_id = $x` everywhere), **all** SQL is parameterized (no injection found), Telegram HMAC crypto is correct in both flows with constant-time compares, optimistic locking is sound, the audit/undo path works, backups are genuinely *verified*, and the real-PG integration suite is better than most production apps. **No SQL injection, no cross-ledger IDOR, no XSS, no RCE, no committed secrets.**

What remains weak is a **cluster of money-integrity + authz-correctness gaps** plus **gate hygiene** — the same theme as the 2026-06-14 C+/B− review, partially fixed but re-surfacing in new forms. **No deploy-blocking Critical** survived verification. The two audits are complementary: Audit A went deeper on money/authz logic; Audit B caught an upload-ordering bug and proved the local gates are currently red/flaky.

> **Threat-model calibration:** live deploy is Tailnet-only (no public internet), two trusted family users (owner + spouse). External-attacker findings are down-weighted; money-correctness and reliability findings (which hit the two real users regardless of the network boundary) are up-weighted.

### Severity tally
| Sev | Count |
|-----|-------|
| Critical | 0 |
| High | 6 | *(H5 withdrawn on verification — see §3)* |
| Medium | 15 |
| Low / Info | ~12 |

---

## 2. Gate status (empirical — Audit B, re-verified)

These are about the repo's *own* quality bar, not runtime behavior.

- **Premerge is RED (M2).** `npm audit --audit-level=moderate` (root `audit:all`, run in premerge) reports a **high** undici advisory (GHSA-vmh5-mc38-953g, GHSA-pr7r-676h-xcf6) via dev-only `jsdom@29 → undici`. Production audit (`--omit=dev`) is clean. Fix: `npm audit fix` (lockfile-only). *Memory predicted this recurrence.*
- **Integration suite is config-valid but not locally runnable on this box (M3).** The external claim that vitest 4's `poolOptions` was removed is **incorrect** — `pool:"forks"` + `poolOptions.forks.singleFork` is valid in vitest 4.1.5 (verified in vitest's own dist). Three runs of identical code passed **21 / 32 / 15** of 44 tests before the disposable `postgres:16-alpine` died mid-run (`the database system is shutting down` / `CONNECTION_CLOSED` / `ECONNREFUSED`). The **nondeterministic pass counts are the signature of an environmental fault** (WSL2 Docker container/port instability, documented for this machine), not a code or config bug. Bypassing the `127.0.0.1` relay via the WSL VM IP did not stabilize it. **Authoritative green signal lives in Forgejo CI** (service Postgres, no WSL relay). *Corollary:* the project's own "authoritative money/authz gate" is currently not cleanly runnable locally — local TDD of money fixes needs Docker Desktop back up or a long-lived compose Postgres.
- **migration-smoke masks stderr (part of M3).** `scripts/migration-smoke.mjs:88` does `throw err` on an *unexpected* failure; `execFile`'s `err.message` is "Command failed…" without `err.stderr`, so the real SQL error is hidden. The reported "IST bucketing failure" can't be diagnosed until stderr is surfaced (and is plausibly the same connection death). 1-line fix.
- Passing (Audit B): `lint`, unit `test`, `build`, backend `verify`, `parser:evaluate`, `e2e` (10 Playwright checks).

---

## 3. High-severity findings

### H1 — Review/confidence gate is not enforced on any total *(Audit A; resolved by DECIDE D2)*
`reviewStatusFromConfidence` (`capture/confidence.ts:114`) deliberately routes weak/misread amounts to `needs_review` (e.g. OCR reading *change-due/tender* as the bill). But **no aggregate filters `review_status`** — `db/query.ts` (all four functions, 0 matches), the dashboard headline (`routes/expenses.ts:1251`), the month-close snapshot (`routes/monthly-review.ts:240`), budgets MTD (`db/budgets.ts:69`), budget alerts (`db/alerts.ts`). `ignored` rows count too. **Impact:** a misread weak amount silently enters spend totals and the *immutable* signed-off close before any human confirms — defeating the advertised "trustworthy close." **→ See D2 for the resolved fix.**

### H2 — A household member can forge settlement attribution to any other member *(Audit A)*
`routes/expenses.ts:505-510` & `:810-815` guard `paid_by_user_id` only with `isActiveLedgerMember(ledgerId, paidBy)` (`db/access.ts:504-517`) — which checks the payer is *some* active member, not that a `can_add`-only member set it **to themselves**. PATCH is scoped by `user_id = ledgerId` with no creator check. **Impact:** the spouse can post/edit a shared expense as `paid_by = <owner>`, inflating the owner's "paid" and erasing their own debt — fabricating who-owes-whom. The code comment at access.ts:498-503 acknowledges this exact risk; the check is insufficient. **Fix:** `if (!session.canManage && body.paid_by_user_id != null && body.paid_by_user_id !== session.telegramUserId) return 403`.

### H3 — Household settlement balances don't net to zero *(Audit A)*
`db/settlements.ts:46-101`: (a) the `members` CTE filters `can_view = TRUE`, so a payment attributed to a since-revoked member is dropped from the payer rollup **but still counted in `total_cents`/`fairShare`**; (b) `fairShare = Math.round(total / n)` (`:69`) leaves a rounding residual. Both make displayed balances sum to non-zero, so the greedy transfer plan under-settles. **Fix:** compute `total`/`fairShare` over the same member set as the payers (or an "other" bucket); distribute the rounding remainder deterministically; add a `sum(balances) == 0` invariant test.

### H4 — "Log out everywhere" is silently dead for the bootstrap owner *(BOTH audits — A + B#1)*
`db/access.ts:171` (`virtualBootstrapOwner`) hardcodes `sessionsInvalidBefore: null`. `POST /api/logout` and `revokeAccessUser` write the revocation epoch (`access.ts:697`), and `getSession` checks it (`routes/auth.ts:155`), but allowlisted owners resolve through the virtual path (`access.ts:294`) and bypass the DB row. **Impact:** a stolen owner session cookie stays valid the full 7-day window regardless of logout. Members are unaffected. **Fix:** read the real `sessions_invalid_before` for bootstrap owners (the row exists after login upsert).

### H5 — ~~CSV/Excel formula injection in xlsx export~~ **WITHDRAWN — false positive (verified 2026-06-19)**
Original claim: `export/xlsx.ts` writes `merchant`/`description`/`tags` verbatim, so `=HYPERLINK(...)` becomes a live formula on open. **This is wrong for the XLSX path.** Empirical probe: ExcelJS stores a `=`-prefixed string as cell **type 3 (String)**, not type 6 (Formula); Excel/LibreOffice render string-typed cells as literal text and do **not** evaluate them. Formula injection is a *CSV* vector (untyped), and there is **no CSV export** in the app — the only `text/csv` emitter, `uploadExport()` (`storage/index.ts:65`), has **zero callers** (dead code). Prepending `'` to an already-string-typed cell would render a *visible* spurious quote, corrupting the data with no safety gain. **No fix applied.** (Minor: delete the dead `uploadExport` — see L-tier.)

### H6 — Statement/card PII sent to MiniMax unredacted *(Audit A; resolved by DECIDE D3)*
`statement/redact.ts` only sanitizes *error strings*; `statement/parser.ts:60-71` sends the full statement text (account numbers, card numbers, holder name/address) verbatim to the LLM. The `understand_image` vision path likewise sends the full receipt image. **→ See D3 for the resolved response (disclosure, not redaction).**

### H7 — Cron: duplicate reminders + no overlap-guard/drain *(Audit A)*
(a) `db/subscription-renewal.ts:104-144` — a subscription with `reminder_days = [7,3,1]` sends **three identical DMs** the day `daysUntil` first drops ≤7 (loop fires for every `r >= daysUntil`, dedups per-`r`). (b) No job has a re-entrancy/advisory-lock guard, and `index.ts` `shutdown()` never `.stop()`s the node-cron tasks nor awaits in-flight runs; the reminder dedup-INSERT happens *after* the send, so a crash re-sends next day. **Fix:** fire only the crossed threshold (`daysUntil === r`); add an in-process `running` guard or `pg_try_advisory_lock` per job; stop crons and await the in-flight promise in `shutdown`.

---

## 4. Medium-severity findings

- **M1 — Receipt attach uploads before proving ownership; coerces bad MIME→JPEG** *(Audit B#3 — confirmed, A missed it).* `routes/expenses.ts:992-1025`: `uploadStatement(...)` at :999 runs **before** the `UPDATE ... WHERE id AND user_id` (404 at :1025), and unsupported MIME silently becomes `image/jpeg` (:995). Orphan blobs (under the user's own prefix) + arbitrary bytes labeled JPEG. **Fix:** check ownership first, `415` on unsupported MIME, cleanup the blob on DB-miss.
- **M2 — Premerge red (undici advisory).** See §2. `npm audit fix`.
- **M3 — Local integration + migration-smoke gates untrustworthy.** See §2. Config is valid; failure is environmental (WSL Docker). Fixes: surface `err.stderr` in migration-smoke; rely on Forgejo CI or a stable local DB; (separately) `npm audit fix` so premerge isn't red.
- **M4 — Ledger invariant unconstrained.** `expenses.user_id` has **no FK** to `ledgers`/`access_users` (mig 001/018). *Not the auditor-A "Critical" — every write path sets `user_id` to the resolving ledger id (`db/expenses.ts:86`), so the month-close trigger scoping holds by construction today.* But nothing at the DB enforces it. **Fix:** add `ledger_id … REFERENCES ledgers(id)` + FK on `paid_by_user_id`.
- **M5 — Immutability/`updated_at` triggers bypassable.** Created without `ENABLE ALWAYS`, so a `session_replication_role=replica` restore/CDC apply skips them and can write into closed months; a table-owner role can `DISABLE TRIGGER`. The app connects as the DB owner (`20-postgres.yaml`). **Fix:** `ENABLE ALWAYS` + a least-privilege app role.
- **M6 — Migration runner has no checksum.** `db/migrate.ts:45` tracks applied state by filename only; an edited already-applied `.sql` silently never re-runs → prod/test schema divergence with no warning. **Fix:** store a SHA-256 per migration, fail on drift.
- **M7 — DB pool hardening.** `db/index.ts:4-14` — no `statement_timeout`, no `idle_in_transaction_session_timeout`, no `ssl`. One stuck query/txn can pin a connection and hold month-close locks. **Fix:** add timeouts + ssl for prod.
- **M8 — Statement importer inserts unvalidated LLM amounts.** `statement/parser.ts:88` — a non-integer aborts the whole import (`BIGINT` cast 22P02); a negative is silently subtracted. **Fix:** validate `Number.isInteger && isFinite` per row; decide a credit policy.
- **M9 — Bot liveness isn't health-checked.** `/health` probes only the DB; a wedged grammy poller drops every Telegram expense while k8s reports the pod healthy. **Fix:** poller watchdog or `/ready` asserting last-update freshness.
- **M10 — Non-atomic delete+audit.** `db/expenses.ts:321`, route `:1048`, bot `:1718` — `DELETE` commits, *then* `recordAuditEvent` runs separately; a crash between = un-undoable money-row loss. **Fix:** wrap in `sql.begin` like the update helpers.
- **M11 — `/merge` deletes without verifying duplicate.** `routes/expenses.ts:1088` — no amount/date check (unlike `/duplicates`), so it's an arbitrary single-row delete dressed as merge. **Fix:** re-validate amount/window inside the tx.
- **M12 — CSRF headerless-allow + SameSite=None** *(BOTH — A + B#2; resolved by DECIDE D1).* `routes/csrf.ts` allows a mutating request with no Origin and no `Sec-Fetch-Site`; prod cookie is `SameSite=None`. **→ See D1 (document the intentional tradeoff; no token).**
- **M13 — Infra hardening (Tailnet-mitigated).** Postgres & MinIO run as **root** (`20-postgres.yaml`/`15-minio.yaml`, no `runAsNonRoot`); **no NetworkPolicy**; nginx serves **zero security headers** (no `frame-ancestors` CSP / `nosniff`). **Fix:** non-root + dropped caps; default-deny NetworkPolicy (verify CNI enforces it); `frame-ancestors` CSP allowing Telegram.
- **M14 — "Tailnet-only" rests on host firewall, not manifests** *(Audit B#6).* `40-frontend.yaml:50` is `NodePort 30080`; `50-ingress.yaml` is deliberately host-unrestricted. The safety property lives in host networking. **Fix:** document + verify the box's interface binding; consider binding NodePort to the Tailscale interface.
- **M15 — Offsite backup: silent-skip + unauthenticated CBC + same-node-only.** `60-backups.yaml:154` `exit 0` when `openssl` is missing ("backups look fine but never upload"); CBC has no integrity; backups live only on the same node until the offsite Secret is created. **Fix:** `exit 1` on missing crypto; authenticated cipher (`age`/GPG/AES-GCM); complete the offsite Secret.

---

## 5. Design decisions (`[DECIDE]` trio outcomes — for sign-off)

Each ran advocate + challenger + supervisor (shipping-biased). All three landed on a **third path**, not the maximalist fix.

### D1 — CSRF: **document the intentional tradeoff; do NOT add a token.** *(resolves M12)*
- **Crux verified:** `sameSite` is set at cookie-write time, so you **cannot** serve `Lax` to the browser and `None` to the Mini-App from one shared cookie — the challenger's one-line `Lax` swap is invalid for this architecture. And the advocate's initData-signed-header scheme adds a 24h re-auth cliff + WKWebView fragility with no CI coverage.
- **Decision:** the current guard already blocks the only realistic browser attack (`Sec-Fetch-Site: cross-site`); on a Tailnet with 2 family users the residual gap (pre-2020 browsers / non-browser clients) is negligible. **Expand the comment in `routes/csrf.ts`** to state that the headerless-allow is intentional for Telegram WKWebView, that `SameSite=None` is load-bearing (cannot become `Lax` without splitting the cookie jar), and that the future hardening path is a dedicated Mini-App origin → then `Lax`. **No code change.**
- **Priority:** documentation, **not** must-fix. Revisit if exposed beyond the Tailnet, a 3rd untrusted user is added, or the Mini-App moves to its own origin.

### D2 — Review-gate in totals: **drop `ignored` everywhere; drop `needs_review` from the immutable close only; keep it (with a badge) in live surfaces.** *(resolves H1)*
- **Crux:** the live overview total and the close total both come from the same SUM (`monthly-review.ts:242` → `:209`). `ignored` = explicitly "not real" → exclude from all aggregates. `needs_review` = real spend with an uncertain amount → excluding from the *live* dashboard would under-count and risk overspending, so **keep it live** (the `needs_review_count` is already in the API for a badge), but **exclude it from the sealed close snapshot** (accounting-grade "confirmed only"; the close already requires the review checklist to be clear).
- **Changes (~7 sites):** add `AND e.review_status != 'ignored'` to the live aggregates in `query.ts` (totalSpendInCategory ×2, spendByCategory, topExpenses, topMerchants), `budgets.ts:69`, `alerts.ts`; add a separate `confirmed_total_cents` (filter `NOT IN ('ignored','needs_review')`) to the overview query and wire **that** into the close record. Don't touch `getExpensesForExport`. Badge is a frontend display decision (descoped).
- **Priority:** **P1** for the close snapshot (sealing a corrupted total is a data-integrity bug), **P2** for the live `ignored` exclusion. Ship together. Needs an integration test asserting the close excludes needs_review.

### D3 — PII to LLM: **add a disclosure now; defer redaction to a named trigger.** *(resolves H6)*
- **Crux:** label-anchored vs. naive redaction — naive digit-run masking would corrupt the UPI/NEFT/RTGS reference numbers and paise amounts that share the 12+ digit shape (silent wrong amounts in a money app), and the vision path sends the whole receipt image unredacted anyway, so text-only redaction is false safety.
- **Decision:** it is the user's own data sent to a provider they chose; no third-party data subject exists today. **Add a one-sentence disclosure** to `StatementImportsPanel.tsx` ("Statement content including account/card numbers is sent to MiniMax for transaction extraction…"), and **review MiniMax's data-processing terms** (record the outcome). **Defer** label-anchored redaction until the app ever processes someone else's statements (multi-tenant / fiduciary).
- **Priority:** Low (disclosure ships in minutes). Revisit triggers: a non-MiniMax-consenting member's statement is uploaded; MiniMax terms allow training on submitted content; or a multi-tenant SaaS offering.

---

## 6. Remediation roadmap (pending sign-off)

**Now — unblock the bar (trivial, safe):**
1. `npm audit fix` → green premerge (M2).
2. 1-line: surface `err.stderr` in `migration-smoke.mjs` (M3), then re-run smoke to see if the IST failure is real or environmental.

**PR 1 — bounded security/correctness (TDD against a stable DB / Forgejo CI):**
3. Owner revocation reads the real epoch (H4).
4. Non-manager `paid_by_user_id` must be self (H2).
5. Receipt attach: ownership-check first, `415` on bad MIME, cleanup blob on DB-miss (M1).
   *(H5 xlsx-escape removed — withdrawn as a false positive on verification.)*

**PR 2 — the resolved design decisions (D1/D2/D3):**
7. D2 query changes — `ignored` out of live aggregates, `confirmed_total_cents` into the close (P1/P2).
8. D3 disclosure copy in `StatementImportsPanel.tsx` + MiniMax DPA review note.
9. D1 — expand the `csrf.ts` threat-model comment (no code).

**PR 3 — reliability / DB hardening:**
10. Cron dedup + drain (H7), settlement netting (H3), pool `statement_timeout`/SSL (M7), `amount_cents` CHECK (L8), `ENABLE ALWAYS` triggers + least-priv role (M5), migration checksum (M6), bot-liveness probe (M9), rate-limit-before-download (L1), non-atomic delete+audit (M10), unvalidated LLM amounts (M8).

**Ops / infra:**
11. Document + verify the NodePort/host-firewall posture (M14), nginx security headers + non-root Postgres/MinIO + NetworkPolicy (M13), complete + harden the offsite-backup Secret (M15), least-priv MinIO/DB roles (L10).

---

## 7. Low / Info

- **L1** media rate-limit runs after download/hash/upload (`handlers.ts:1814`, after `:1798`) — limiter guards the LLM call, not storage *(Audit B#7)*.
- **L2** statement dedup greedy first-match, candidate query has no `ORDER BY` → can drop a legit same-amount txn (`statement/dedup.ts:55`).
- **L3** whisper/ffmpeg subprocess has no execution timeout (`voice/transcribe.ts`) → can hang a capture.
- **L4** capture replay isn't an atomic claim (`routes/captures.ts:178`) → double-click can double-insert.
- **L5** FX `fetch` has no timeout (`fx/rates.ts:75`) — fails safe to stale cache, but can stall the subscriptions request.
- **L6** dead `getStatementDownloadUrl` presign helper (`storage/index.ts:35`) contradicts the proxy-only design; unused except a test mock — delete.
- **L7** `sc:` bot callback skips write-recheck → a just-revoked member can recategorize for ≤30 min (`bot/handlers.ts`).
- **L8** `expenses.amount_cents` has no `CHECK (> 0)` (mig 001) — the integer-money invariant isn't DB-enforced.
- **L9** frontend: dashboard strands on a transient fetch error (`dashboard/page.tsx:71`); `/manage` 403-cascades for non-owner members (no data leak); `formatCents` renders `₹NaN` on bad input (`lib/api.ts`).
- **L10** MinIO root creds == app S3 creds; app uses the DB owner role (defense-in-depth).
- **Info** `CREATE OR REPLACE TRIGGER` is PG14+ — **moot** on the `postgres:16.8` deploy (portability note only). CSRF `Host`-header trust in the origin check.

---

## 8. What's genuinely done well
Parameterized SQL throughout · correct Telegram HMAC (both flows, constant-time, `auth_date` expiry) · httpOnly/secure/sameSite session cookie never touched by JS · service worker bypasses `/api/*` (no cross-user cache) · no XSS sinks · sound optimistic locking (`FOR UPDATE OF e` + version check) · receipt-image **proxy** is IDOR/traversal-safe · lakh/crore parsing + change-due exclusion correct · subprocesses use array-arg `spawn` (no shell injection) · subscription cadence math is calendar-correct (Jan31→Feb28→Mar31) · backups are verified, not cosmetic · k8s backend runs non-root with dropped caps + resource limits · jsonb double-encode bug class eliminated · real-PG integration suite that has already caught money-path bugs.

---
*Generated 2026-06-19 from internal 8-agent sweep + external execution-based sweep, reconciled. 7/7 external findings verified (one root-cause correction on the vitest config claim). Three design findings resolved via a `[DECIDE]` trio (§5). No code modified.*
