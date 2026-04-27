# Run on Dalekdefender after `git pull`. Single-node k3s assumed.
#
# First-time setup:
#   make deploy             # build both images, import, apply manifests
#   make secrets            # interactive create of khata-secrets (one-time)
#   make migrate            # run schema migrations (one-time per fresh DB)
#   make tailscale-serve    # bind Tailscale Serve to localhost:80
#
# Day-to-day:
#   make deploy             # rebuild + reapply after `git pull`
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

.PHONY: build build-backend build-frontend import import-backend import-frontend \
        deploy migrate logs status secrets restart undeploy tailscale-serve tailscale-status

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

deploy: build import
	kubectl apply -f $(DEPLOY_DIR)/k8s/00-namespace.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/15-minio.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/20-postgres.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/30-backend.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/40-frontend.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/50-ingress.yaml
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
