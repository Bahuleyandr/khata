#!/bin/sh

set -eu
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
psql \
  --host=khata-postgres.khata.svc.cluster.local \
  --username=khata \
  --dbname=khata \
  --set=ON_ERROR_STOP=1 \
  --command="INSERT INTO backup_runs (kind, status, detail) VALUES ('minio', 'ok', '${stamp}');"
          