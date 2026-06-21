#!/bin/sh

set -eu
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/khata-minio-${stamp}/${S3_BUCKET}"
mc alias set local http://khata-minio.khata.svc.cluster.local:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mkdir -p "$target"
mc mirror --overwrite "local/${S3_BUCKET}" "$target"
find /backups -mindepth 1 -maxdepth 1 -type d -name 'khata-minio-*' -mtime +14 -exec rm -rf {} \;
              