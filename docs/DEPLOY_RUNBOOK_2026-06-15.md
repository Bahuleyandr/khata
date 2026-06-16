# Khata deploy runbook — un-hold the sprint (2026-06-15)

Brings the entire held sprint live on Dalekdefender. You run these on the box;
paste the output at each **⏸ CHECKPOINT** and Claude will verify before you continue.

## What this deploy changes
- **8 migrations (025→032)**, in order:
  - 025 month-close immutability trigger → **closed months become read-only live** (edits show a "reopen first" message — expected).
  - 026 session revocation · 027 timezone→IST (`ALTER DATABASE … SET timezone='Asia/Kolkata'`) · 028 `expenses.updated_at` + trigger.
  - **029 + 030 decode existing double-encoded jsonb rows** (confidence/audit/diagnosis/snapshot/insights) — these *rewrite existing data*, so back up first.
  - 031 subscription renewal tables · 032 ops-health heartbeat + dedup tables.
- **New code**: IST bucketing, captures own-scope authz, optimistic-lock on the dashboard PATCH (409), rate-limiting on all LLM paths, subscription renewal engine, ops-health → owner DM cron, manage-page decomposition.
- **Backups**: hardened restore drill (freshness + `--exit-on-error` + row-count) + dump sanity + MinIO job restructure + offsite upload (inert until a Secret).

> Do NOT add a `TZ` env to the backend pod — node-cron schedules are authored for UTC; IST comes from in-app helpers.

## 0. Pre-flight
```bash
ssh dd                       # or: ssh dd-ip   (if MagicDNS is flaky)
cd ~/khata && git pull --ff-only
git log --oneline -1         # expect d1681f8 (or later)
cd deploy
```

## 1. BACK UP FIRST — do not skip (029/030 rewrite existing data)
```bash
make backup
# → ~/khata/backups/<ts>/khata-postgres.dump  +  khata-minio-data.tgz
make restore-dry-run \
  BACKUP_FILE=~/khata/backups/<ts>/khata-postgres.dump \
  MINIO_BACKUP_FILE=~/khata/backups/<ts>/khata-minio-data.tgz
make restore-to-temp-db BACKUP_FILE=~/khata/backups/<ts>/khata-postgres.dump   # proves it actually restores
```
**⏸ CHECKPOINT A** — paste the dry-run / temp-db output (must say *readable* / *validated*). Keep this dump; it is the migration rollback.

## 2. Validate the one changed manifest (catches k8s schema errors not checkable off-cluster)
```bash
kubectl apply --dry-run=server -f k8s/60-backups.yaml
```
**⏸ CHECKPOINT B** — expect every object `… (server dry run)` with NO errors. If it errors, STOP and paste it.

## 3. Deploy (rebuild both images + apply manifests + rollout)
```bash
make deploy
```
First backend build is ~5–10 min (Python + uv + whisper.cpp). `make deploy` = build → `sudo k3s ctr images import` (prompts for sudo) → apply all manifests → rollout restart backend + frontend.
**⏸ CHECKPOINT C** — paste the final rollout lines.

## 4. Migrate IMMEDIATELY after deploy (025→032)
Run right after step 3 — the new code expects the new columns, so there's a brief window where new-code-on-old-schema 500s some queries until this runs.
```bash
make migrate
kubectl exec -n khata deploy/khata-postgres -- psql -U khata -d khata -c "select max(filename) from schema_migrations;"
```
**⏸ CHECKPOINT D** — `make migrate` should print `apply 025_… … apply 032_…` then "Migrations complete.", and `max(filename)` = `032_ops_health_heartbeats.sql`.

## 5. Verify
```bash
make smoke      # rollouts Ready + the 3 backup CronJobs exist + /health ok
make status
```
From a tailnet device:
- `curl https://dalekdefender.<tailnet>.ts.net/health` → `{"status":"ok","db":"ok"}`
- Dashboard → log in → open **Manage** (decomposed page): every panel renders.
- Bot: `$45 lunch` → logs + replies in ~1–2 s.
- Edit an expense in a **closed** month → expect "reopen first" (025 live).

**⏸ CHECKPOINT E** — paste `make smoke` + the `/health` output + anything odd.

## 6. (Optional) Enable offsite backups — both Postgres + MinIO
Built and INERT until this Secret exists. Any S3-compatible target (Cloudflare R2 / Backblaze B2 / AWS S3):
```bash
kubectl create secret generic khata-backup-offsite -n khata \
  --from-literal=ENDPOINT="https://<your-s3-endpoint>" \
  --from-literal=BUCKET="<your-bucket>" \
  --from-literal=ACCESS_KEY_ID="<key>" \
  --from-literal=SECRET_ACCESS_KEY="<secret>" \
  --from-literal=PASSPHRASE="$(openssl rand -hex 24)"
```
⚠️ **Save the PASSPHRASE off the box** — without it the encrypted offsite backups are unrecoverable. The next nightly run uploads `postgres/*.enc` and `minio/*.tar.gz.enc`.

## 7. (Optional) Prove the hardened restore drill
```bash
make restore-drill
kubectl get jobs,pods -n khata | grep restore-drill   # then check its log
```

## 8. CI — first Forgejo run
The push already triggered Forgejo CI. Check Forgejo → khata → **Actions**. `verify` should pass; if the `integration` job fails on DB connection (service-postgres hostname), paste the log and Claude will adjust.

## Rollback
```bash
kubectl rollout undo deployment/khata-backend  -n khata
kubectl rollout undo deployment/khata-frontend -n khata
```
Migrations have no down-scripts; to revert schema, restore the step-1 dump (destructive `pg_restore --clean` into `khata` — ask Claude for the exact command).
