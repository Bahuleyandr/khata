# Deploy

Single-node k3s on **Dalekdefender** (Ubuntu 26.04). Public ingress via host-systemd `cloudflared` + Cloudflare Tunnel. No public IPv4 needed (Dalekdefender is behind home NAT).

```
Telegram         ─►  Cloudflare Tunnel  ─►  cloudflared (host)  ─►  Traefik (k3s)
                          │                          │                      │
Browser  ─►  GH Pages (khata.bahulyean.com, frontend)│                      ▼
                                                     │              khata-backend Service
                                                     │                      │
              api.khata.bahulyean.com  ─────────────►│                      ▼
                                                                 ┌─►  khata-postgres (in-cluster, PVC)
                                                                 ├─►  Cloudflare R2 (statements + receipts)
                                                                 └─►  OpenRouter (Claude / MiniMax / GPT)
```

## What lives where

| Piece | Location | Notes |
|---|---|---|
| Frontend (`khata.bahulyean.com`) | GitHub Pages, CNAME from Cloudflare | Built from `app/` via `.github/workflows/deploy.yml` on push to main |
| Backend API (`api.khata.bahulyean.com`) | k3s on Dalekdefender, exposed via cloudflared | `khata-backend` Deployment in `khata` namespace |
| Postgres | k3s on Dalekdefender, in-cluster | `khata-postgres` Deployment + `khata-postgres-data` PVC (5Gi, local-path) |
| Statement / receipt blobs | Cloudflare R2 | Unchanged from Fly setup |
| LLM | OpenRouter | Per-intent model via env vars; defaults: Haiku 4.5 (text), Sonnet 4.6 (vision) |

## First-time setup

Once per cluster. After this, deploys are just `git pull && make deploy`.

### 1. Cloudflare Tunnel

```bash
# On Dalekdefender:
sudo cloudflared tunnel login                       # opens browser; auth to your Cloudflare account
sudo cloudflared tunnel create khata                # creates tunnel, emits UUID + credentials JSON
sudo cloudflared tunnel route dns khata api.khata.bahulyean.com
sudo cp deploy/cloudflared/config.example.yaml /etc/cloudflared/config.yml
sudo $EDITOR /etc/cloudflared/config.yml            # fill in <TUNNEL-UUID>
sudo cloudflared service install                    # /etc/systemd/system/cloudflared.service
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared                   # verify Active: running
```

### 2. Cloudflare DNS for the frontend

In the Cloudflare dashboard for `bahulyean.com`, add:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `khata` | `Bahuleyandr.github.io` | Proxied (orange cloud) |

(`api.khata.bahulyean.com` is handled by `cloudflared tunnel route dns` above — don't add it manually.)

### 3. GitHub Pages CNAME for the frontend

Already wired in `.github/workflows/deploy.yml`. If you ever switch domains, update the `cname:` field there.

### 4. GitHub repo variables for the frontend build

In repo Settings → Secrets and variables → Actions → Variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.khata.bahulyean.com` |
| `NEXT_PUBLIC_BOT_USERNAME` | your bot's `@handle` without the `@` |

### 5. Backend deployment

```bash
# On Dalekdefender:
git clone https://github.com/Bahuleyandr/khata.git
cd khata/deploy

make deploy            # build → import → apply manifests
make secrets           # interactive prompts for each secret (one-time)
kubectl rollout restart deployment/khata-backend -n khata
make migrate           # apply Postgres schema migrations (one-time per fresh DB)
make webhook           # register Telegram webhook → api.khata.bahulyean.com/telegram/webhook
make status            # verify everything is Running and the Ingress has an address
```

Sanity check from anywhere:

```bash
curl https://api.khata.bahulyean.com/health
# {"status":"ok","db":"ok"}
```

## Day-to-day

After making backend changes:

```bash
# On dev machine: push as usual
git push

# On Dalekdefender:
cd ~/khata && git pull && cd deploy && make deploy
```

Frontend deploys are automatic on push to main (GitHub Actions → GH Pages).

## Reference

| Command | What it does |
|---|---|
| `make build` | `docker build` the backend image |
| `make import` | Load image into k3s containerd (`k3s ctr images import`) |
| `make deploy` | build + import + `kubectl apply -f deploy/k8s/` + rollout restart |
| `make secrets` | One-time interactive create of `khata-secrets` Secret |
| `make migrate` | Run pending Postgres migrations |
| `make webhook` | (Re-)register the Telegram webhook |
| `make logs` | Tail backend logs |
| `make status` | `kubectl get all -n khata` + Ingress |
| `make restart` | Restart the backend Deployment |
| `make undeploy` | Delete the entire `khata` namespace (destructive) |

## Assumptions about the cluster

- k3s default Traefik ingress controller is enabled (`kubectl -n kube-system get svc traefik` shows a LoadBalancer). If you ran k3s with `--disable=traefik`, the Ingress in `40-ingress.yaml` won't be picked up — either re-enable Traefik or swap the manifests for NodePort + bypass.
- k3s Klipper service-LB is enabled (default) — it binds Traefik to host ports 80/443 so cloudflared can reach it via `http://localhost:80`.
- Local-path-provisioner is enabled (default) for the Postgres PVC.

## Backups (TODO)

Postgres data lives on a single PVC on Dalekdefender's NVMe. No automated backups yet. Recommended: a nightly `pg_dump` cron that ships to R2. Will add in a follow-up.
