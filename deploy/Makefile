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

.PHONY: build build-backend build-frontend import import-backend import-frontend \
        deploy migrate logs status secrets restart undeploy tailscale-serve tailscale-status

build: build-backend build-frontend

build-backend:
	docker build -t $(BACKEND_IMAGE) $(ROOT)/backend

build-frontend:
	docker build -t $(FRONTEND_IMAGE) -f $(DEPLOY_DIR)/Dockerfile.frontend $(ROOT)

import: import-backend import-frontend

import-backend:
	docker save $(BACKEND_IMAGE) | sudo k3s ctr images import -

import-frontend:
	docker save $(FRONTEND_IMAGE) | sudo k3s ctr images import -

deploy: build import
	kubectl apply -f $(DEPLOY_DIR)/k8s/00-namespace.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/20-postgres.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/30-backend.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/40-frontend.yaml
	kubectl apply -f $(DEPLOY_DIR)/k8s/50-ingress.yaml
	kubectl rollout restart deployment/khata-backend  -n $(NS)
	kubectl rollout restart deployment/khata-frontend -n $(NS)

migrate:
	kubectl exec -n $(NS) deploy/khata-backend -- npm run migrate

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

# One-time: create the khata-secrets Secret. Reads each value interactively.
secrets:
	@read -s -p "POSTGRES_PASSWORD: " POSTGRES_PASSWORD; echo; \
	read -p  "TELEGRAM_BOT_TOKEN: " TELEGRAM_BOT_TOKEN; \
	read -p  "ALLOWED_TELEGRAM_USER_IDS (comma-separated): " ALLOWED_TELEGRAM_USER_IDS; \
	read -s -p "SESSION_SECRET (openssl rand -hex 32): " SESSION_SECRET; echo; \
	read -p  "MINIMAX_API_KEY: " MINIMAX_API_KEY; \
	read -p  "S3_ENDPOINT: " S3_ENDPOINT; \
	read -p  "S3_BUCKET [khata-statements]: " S3_BUCKET; S3_BUCKET=$${S3_BUCKET:-khata-statements}; \
	read -p  "S3_REGION [auto]: " S3_REGION; S3_REGION=$${S3_REGION:-auto}; \
	read -p  "S3_ACCESS_KEY_ID: " S3_ACCESS_KEY_ID; \
	read -s -p "S3_SECRET_ACCESS_KEY: " S3_SECRET_ACCESS_KEY; echo; \
	kubectl create secret generic khata-secrets -n $(NS) \
		--from-literal=POSTGRES_PASSWORD="$$POSTGRES_PASSWORD" \
		--from-literal=TELEGRAM_BOT_TOKEN="$$TELEGRAM_BOT_TOKEN" \
		--from-literal=ALLOWED_TELEGRAM_USER_IDS="$$ALLOWED_TELEGRAM_USER_IDS" \
		--from-literal=SESSION_SECRET="$$SESSION_SECRET" \
		--from-literal=MINIMAX_API_KEY="$$MINIMAX_API_KEY" \
		--from-literal=S3_ENDPOINT="$$S3_ENDPOINT" \
		--from-literal=S3_BUCKET="$$S3_BUCKET" \
		--from-literal=S3_REGION="$$S3_REGION" \
		--from-literal=S3_ACCESS_KEY_ID="$$S3_ACCESS_KEY_ID" \
		--from-literal=S3_SECRET_ACCESS_KEY="$$S3_SECRET_ACCESS_KEY"

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
