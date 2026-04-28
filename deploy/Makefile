# Run on Dalekdefender after `git pull`. Single-node k3s assumed.
#
# First-time setup:
#   make namespace          # create the khata namespace
#   make secrets            # interactive create of khata-secrets (one-time)
#   make deploy             # build both images, import, apply manifests
#   make minio-bucket       # create the receipt/statement bucket
#   make migrate            # run schema migrations
#   make tailscale-serve    # bind Tailscale Serve to localhost:80
#   make smoke              # verify backend/frontend are reachable
#
# Day-to-day:
#   make deploy             # rebuild + reapply after `git pull`
#   make backup             # local timestamped Postgres + MinIO backup
#   make logs               # tail backend logs
#   make status             # see pods/services/ingress
#
# The bot uses long-polling — there is no webhook URL to register.

BACKEND_IMAGE  := khata-backend:latest
FRONTEND_IMAGE := khata-frontend:latest
NS             := khata
DEPLOY_DIR     := $(realpath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT           := $(realpath $(DEPLOY_DIR)/..)

# Telegram bot @username for the Login Widget (baked into the Next.js
# static export at build time — Next.js can't read env vars at runtime
# from a static build). Override via env if you change bots:
#   BOT_USERNAME=other_bot make build-frontend
BOT_USERNAME ?= Apoorva_Expense_Tracker_bot
BACKUP_DIR ?= $(ROOT)/backups/$$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE ?=
MINIO_BACKUP_FILE ?=
MINIO_BACKUP_DIR ?=
TEMP_RESTORE_DB ?= khata_restore_check

.PHONY: build build-backend build-frontend import import-backend import-frontend \
        deploy namespace migrate logs status secrets restart undeploy tailscale-serve \
        tailscale-status minio-bucket backup backup-postgres backup-minio \
        restore-dry-run restore-postgres-dry-run restore-minio-dry-run \
        restore-to-temp-db smoke

build: build-backend build-frontend

build-backend:
	docker build -t $(BACKEND_IMAGE) $(ROOT)/backend

build-frontend:
	docker build -t $(FRONTEND_IMAGE) -f $(DEPLOY_DIR)/Dockerfile.frontend \
		--build-arg NEXT_PUBLIC_BOT_USERNAME=$(BOT_USERNAME) \
		$(ROOT)

import: import-backend import-frontend

import-backend:
	docker save $(BACKEND_IMAGE) | sudo k3s ctr images import -

import-frontend:
	docker save $(FRONTEND_IMAGE) | sudo k3s ctr images import -

namespace:
	kubectl apply -f $(DEPLOY_DIR)/k8s/00-namespace.yaml

deploy: build import namespace
	kubectl apply -f $(DEPLOY_DIR)/k8s/15-minio.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/20-postgres.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/30-backend.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/40-frontend.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/50-ingress.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/60-backups.yaml
	kubectl rollout restart deployment/khata-backend  -n $(NS)
	kubectl rollout restart deployment/khata-frontend -n $(NS)

# Create the khata-statements bucket inside MinIO. Idempotent — re-running is
# safe (mc mb -p does nothing if the bucket exists). Run once after `make
# secrets` and the MinIO Pod is Ready.
minio-bucket:
	@AK=$$(kubectl get secret khata-secrets -n $(NS) -o jsonpath='{.data.S3_ACCESS_KEY_ID}'     | base64 -d); \
	SK=$$(kubectl get secret khata-secrets -n $(NS) -o jsonpath='{.data.S3_SECRET_ACCESS_KEY}' | base64 -d); \
	BK=$$(kubectl get secret khata-secrets -n $(NS) -o jsonpath='{.data.S3_BUCKET}'            | base64 -d); \
	kubectl exec -n $(NS) deploy/khata-minio -- /bin/sh -c \
		"mc alias set local http://localhost:9000 '$$AK' '$$SK' >/dev/null && mc mb -p local/$$BK"

migrate:
	kubectl exec -n $(NS) deploy/khata-backend -- node dist/db/migrate.js

backup: backup-postgres backup-minio
	@echo "Backup complete: $(BACKUP_DIR)"

backup-postgres:
	@mkdir -p "$(BACKUP_DIR)"
	kubectl exec -n $(NS) deploy/khata-postgres -- pg_dump -U khata -d khata --format=custom --no-owner --no-acl > "$(BACKUP_DIR)/khata-postgres.dump"

backup-minio:
	@mkdir -p "$(BACKUP_DIR)"
	kubectl exec -n $(NS) deploy/khata-minio -- tar -C /data -cz . > "$(BACKUP_DIR)/khata-minio-data.tgz"

restore-dry-run: restore-postgres-dry-run restore-minio-dry-run

restore-postgres-dry-run:
	@test -n "$(BACKUP_FILE)" || (echo "Set BACKUP_FILE=/path/to/khata-postgres.dump"; exit 1)
	@cat "$(BACKUP_FILE)" | kubectl exec -i -n $(NS) deploy/khata-postgres -- pg_restore --list >/dev/null
	@echo "Postgres backup is readable: $(BACKUP_FILE)"

restore-minio-dry-run:
	@if [ -n "$(MINIO_BACKUP_FILE)" ]; then \
		tar -tzf "$(MINIO_BACKUP_FILE)" >/dev/null; \
		echo "MinIO tar backup is readable: $(MINIO_BACKUP_FILE)"; \
	elif [ -n "$(MINIO_BACKUP_DIR)" ]; then \
		test -d "$(MINIO_BACKUP_DIR)" || (echo "No such MINIO_BACKUP_DIR: $(MINIO_BACKUP_DIR)"; exit 1); \
		find "$(MINIO_BACKUP_DIR)" -type f -print -quit | grep -q . || (echo "MinIO backup directory has no files: $(MINIO_BACKUP_DIR)"; exit 1); \
		echo "MinIO mirror backup has files: $(MINIO_BACKUP_DIR)"; \
	else \
		echo "Set MINIO_BACKUP_FILE=/path/to/khata-minio-data.tgz or MINIO_BACKUP_DIR=/path/to/khata-minio-..."; \
		exit 1; \
	fi

restore-to-temp-db:
	@test -n "$(BACKUP_FILE)" || (echo "Set BACKUP_FILE=/path/to/khata-postgres.dump"; exit 1)
	kubectl exec -n $(NS) deploy/khata-postgres -- psql -U khata -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $(TEMP_RESTORE_DB) WITH (FORCE);"
	kubectl exec -n $(NS) deploy/khata-postgres -- psql -U khata -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $(TEMP_RESTORE_DB);"
	cat "$(BACKUP_FILE)" | kubectl exec -i -n $(NS) deploy/khata-postgres -- pg_restore -U khata -d $(TEMP_RESTORE_DB) --clean --if-exists --no-owner --no-acl --exit-on-error
	kubectl exec -n $(NS) deploy/khata-postgres -- psql -U khata -d $(TEMP_RESTORE_DB) -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS expenses FROM expenses;"
	kubectl exec -n $(NS) deploy/khata-postgres -- psql -U khata -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $(TEMP_RESTORE_DB) WITH (FORCE);"
	@echo "Postgres restore validated in temp database: $(TEMP_RESTORE_DB)"

smoke:
	kubectl rollout status deployment/khata-postgres -n $(NS) --timeout=120s
	kubectl rollout status deployment/khata-minio -n $(NS) --timeout=120s
	kubectl rollout status deployment/khata-backend -n $(NS) --timeout=120s
	kubectl rollout status deployment/khata-frontend -n $(NS) --timeout=120s
	kubectl get cronjob/khata-postgres-backup -n $(NS)
	kubectl get cronjob/khata-minio-backup -n $(NS)
	kubectl exec -n $(NS) deploy/khata-backend -- node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1);return r.text()}).then(console.log)"

logs:
	kubectl logs -n $(NS) -l app=khata-backend -f --tail=100

status:
	kubectl get all -n $(NS)
	@echo ""
	@kubectl get ingress -n $(NS)
	@echo ""
	@$(MAKE) tailscale-status --no-print-directory

restart:
	kubectl rollout restart deployment/khata-backend  -n $(NS)
	kubectl rollout restart deployment/khata-frontend -n $(NS)

undeploy:
	kubectl delete namespace $(NS)

# One-time: create the khata-secrets Secret.
#
# Auto-generates ephemeral values for everything internal (POSTGRES_PASSWORD,
# SESSION_SECRET, S3_ACCESS_KEY_ID/SECRET — these are shared between MinIO
# and the backend). S3_ENDPOINT/BUCKET/REGION default to in-cluster MinIO.
# Only prompts for the three things you actually have to provide:
# Telegram bot token, your TG user IDs, and your MiniMax API key.
secrets:
	@POSTGRES_PASSWORD=$$(openssl rand -hex 16); \
	SESSION_SECRET=$$(openssl rand -hex 32); \
	S3_ACCESS_KEY_ID=khata-$$(openssl rand -hex 6); \
	S3_SECRET_ACCESS_KEY=$$(openssl rand -hex 24); \
	read -p  "TELEGRAM_BOT_TOKEN: " TELEGRAM_BOT_TOKEN; \
	read -p  "ALLOWED_TELEGRAM_USER_IDS (comma-separated): " ALLOWED_TELEGRAM_USER_IDS; \
	read -p  "MINIMAX_API_KEY: " MINIMAX_API_KEY; \
	kubectl create secret generic khata-secrets -n $(NS) \
		--from-literal=POSTGRES_PASSWORD="$$POSTGRES_PASSWORD" \
		--from-literal=TELEGRAM_BOT_TOKEN="$$TELEGRAM_BOT_TOKEN" \
		--from-literal=ALLOWED_TELEGRAM_USER_IDS="$$ALLOWED_TELEGRAM_USER_IDS" \
		--from-literal=SESSION_SECRET="$$SESSION_SECRET" \
		--from-literal=MINIMAX_API_KEY="$$MINIMAX_API_KEY" \
		--from-literal=S3_ENDPOINT="http://khata-minio.khata.svc.cluster.local:9000" \
		--from-literal=S3_BUCKET="khata-statements" \
		--from-literal=S3_REGION="us-east-1" \
		--from-literal=S3_ACCESS_KEY_ID="$$S3_ACCESS_KEY_ID" \
		--from-literal=S3_SECRET_ACCESS_KEY="$$S3_SECRET_ACCESS_KEY"
	@echo ""
	@echo "Secret created. Now run: make minio-bucket  (after MinIO Pod is Ready)"

# Bind Tailscale Serve to localhost:80 (where k3s Traefik listens). After this,
# the dashboard is reachable at https://<your-host>.<tailnet>.ts.net from any
# tailnet-connected device. TLS cert is auto-provisioned by Tailscale.
tailscale-serve:
	sudo tailscale serve --bg --https=443 / http://localhost:80
	@echo ""
	@echo "Serve enabled. Dashboard URL:"
	@tailscale serve status

tailscale-status:
	@tailscale serve status 2>/dev/null || echo "(tailscale serve not configured — run 'make tailscale-serve')"
