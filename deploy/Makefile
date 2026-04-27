# Run on Dalekdefender after `git pull`. Single-node k3s assumed.
#
# Workflow:
#   make build      # docker build the backend image
#   make import     # load image into k3s containerd
#   make secrets    # one-time: prompt-create the khata-secrets Secret
#   make deploy     # apply manifests
#   make migrate    # one-time per fresh DB: run schema migrations
#   make logs       # tail backend logs
#   make status     # kubectl get all -n khata
#   make webhook    # register Telegram webhook URL (one-time after first deploy)

IMAGE := khata-backend:latest
NS := khata
ROOT := $(realpath $(dir $(lastword $(MAKEFILE_LIST)))/..)

.PHONY: build import deploy migrate logs status secrets webhook restart undeploy

build:
	docker build -t $(IMAGE) $(ROOT)/backend

import:
	docker save $(IMAGE) | sudo k3s ctr images import -

deploy: build import
	kubectl apply -f $(ROOT)/deploy/k8s/00-namespace.yaml
	kubectl apply -f $(ROOT)/deploy/k8s/20-postgres.yaml
	kubectl apply -f $(ROOT)/deploy/k8s/30-backend.yaml
	kubectl apply -f $(ROOT)/deploy/k8s/40-ingress.yaml
	kubectl rollout restart deployment/khata-backend -n $(NS)

migrate:
	kubectl exec -n $(NS) deploy/khata-backend -- npm run migrate

logs:
	kubectl logs -n $(NS) -l app=khata-backend -f --tail=100

status:
	kubectl get all -n $(NS)
	@echo ""
	@kubectl get ingress -n $(NS)

restart:
	kubectl rollout restart deployment/khata-backend -n $(NS)

undeploy:
	kubectl delete namespace $(NS)

# One-time: create the khata-secrets Secret. Reads each value interactively.
# Use this OR a sealed-secrets / sops workflow — DON'T apply 10-secret.example.yaml
# directly (the values there are placeholders).
secrets:
	@read -s -p "POSTGRES_PASSWORD: " POSTGRES_PASSWORD; echo; \
	read -p  "TELEGRAM_BOT_TOKEN: " TELEGRAM_BOT_TOKEN; \
	read -p  "TELEGRAM_WEBHOOK_SECRET: " TELEGRAM_WEBHOOK_SECRET; \
	read -p  "ALLOWED_TELEGRAM_USER_IDS (comma-separated): " ALLOWED_TELEGRAM_USER_IDS; \
	read -s -p "SESSION_SECRET (openssl rand -hex 32): " SESSION_SECRET; echo; \
	read -p  "OPENROUTER_API_KEY: " OPENROUTER_API_KEY; \
	read -p  "S3_ENDPOINT: " S3_ENDPOINT; \
	read -p  "S3_BUCKET [khata-statements]: " S3_BUCKET; S3_BUCKET=$${S3_BUCKET:-khata-statements}; \
	read -p  "S3_REGION [auto]: " S3_REGION; S3_REGION=$${S3_REGION:-auto}; \
	read -p  "S3_ACCESS_KEY_ID: " S3_ACCESS_KEY_ID; \
	read -s -p "S3_SECRET_ACCESS_KEY: " S3_SECRET_ACCESS_KEY; echo; \
	kubectl create secret generic khata-secrets -n $(NS) \
		--from-literal=POSTGRES_PASSWORD="$$POSTGRES_PASSWORD" \
		--from-literal=TELEGRAM_BOT_TOKEN="$$TELEGRAM_BOT_TOKEN" \
		--from-literal=TELEGRAM_WEBHOOK_SECRET="$$TELEGRAM_WEBHOOK_SECRET" \
		--from-literal=ALLOWED_TELEGRAM_USER_IDS="$$ALLOWED_TELEGRAM_USER_IDS" \
		--from-literal=SESSION_SECRET="$$SESSION_SECRET" \
		--from-literal=OPENROUTER_API_KEY="$$OPENROUTER_API_KEY" \
		--from-literal=S3_ENDPOINT="$$S3_ENDPOINT" \
		--from-literal=S3_BUCKET="$$S3_BUCKET" \
		--from-literal=S3_REGION="$$S3_REGION" \
		--from-literal=S3_ACCESS_KEY_ID="$$S3_ACCESS_KEY_ID" \
		--from-literal=S3_SECRET_ACCESS_KEY="$$S3_SECRET_ACCESS_KEY"

# Tell Telegram where to POST updates. Reads bot token + webhook secret out of the
# in-cluster Secret; runs once per deploy URL change.
webhook:
	@TOKEN=$$(kubectl get secret khata-secrets -n $(NS) -o jsonpath='{.data.TELEGRAM_BOT_TOKEN}' | base64 -d); \
	SECRET=$$(kubectl get secret khata-secrets -n $(NS) -o jsonpath='{.data.TELEGRAM_WEBHOOK_SECRET}' | base64 -d); \
	curl -sS -X POST "https://api.telegram.org/bot$$TOKEN/setWebhook" \
		-H "Content-Type: application/json" \
		-d "{\"url\":\"https://api.khata.bahulyean.com/telegram/webhook\",\"secret_token\":\"$$SECRET\"}" \
		| python3 -m json.tool
