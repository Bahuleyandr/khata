#!/bin/sh

set -eu
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="/backups/khata-postgres-${stamp}.dump"
pg_dump \
  --host=khata-postgres.khata.svc.cluster.local \
  --username=khata \
  --dbname=khata \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${outfile}"
# Change 1: dump sanity — fail the job immediately if the
# custom-format file cannot be parsed (corrupt / truncated).
pg_restore --list "${outfile}" >/dev/null
# Heartbeat: record successful postgres backup in backup_runs.
psql \
  --host=khata-postgres.khata.svc.cluster.local \
  --username=khata \
  --dbname=khata \
  --set=ON_ERROR_STOP=1 \
  --command="INSERT INTO backup_runs (kind, status, detail) VALUES ('postgres', 'ok', '${stamp}');"
find /backups -type f -name 'khata-postgres-*.dump' -mtime +14 -delete
              