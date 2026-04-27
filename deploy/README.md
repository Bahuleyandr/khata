# Deploy

Single-node k3s on **Dalekdefender** (Ubuntu 26.04). Public access is *off* — the dashboard is reachable only from devices on your Tailscale tailnet via Tailscale Serve. The Telegram bot uses long-polling, so no inbound port is opened.

```
                                      Telegram ─► (outbound poll) ─► bot.start() inside backend
                                                                            │
Tailnet device  ─►  Tailscale edge  ─►  cloudflared/wireguard  ─►  Tailscale Serve (host)
                                                                            │ forwards to localhost:80
                                                                            ▼
                                                                       Traefik (k3s)
                                                                            │  routes by path
                                                       ┌────────────────────┼────────────────────┐
                                                       ▼                    ▼                    ▼
                                                 / (frontend)        /api/* (backend)        /health
                                                 nginx + static      Fastify                 Fastify
                                                 next.js export       │
                                                                      ├─►  khata-postgres (in-cluster, PVC)
                                                                      ├─►  Cloudflare R2 (statements + receipts)
                                                                      ├─►  api.minimax.io  (text via OpenAI-compat)
                                                                      └─►  uvx minimax-coding-plan-mcp (subprocess, vision)
```

## Pieces

| | Where | Notes |
|---|---|---|
| Frontend | k3s Deployment `khata-frontend` (nginx + Next.js static export) | Path `/` on the Tailscale hostname |
| Backend | k3s Deployment `khata-backend` (Fastify + grammy long-polling + MiniMax MCP subprocess) | Paths `/api/*` and `/health` |
| Postgres | k3s Deployment `khata-postgres` + PVC `khata-postgres-data` (5Gi local-path) | `khata-postgres.khata.svc.cluster.local:5432` |
| Statement / receipt blobs | Cloudflare R2 | External; presigned URLs from backend |
| LLM (text) | MiniMax `MiniMax-M2.7-highspeed` via `https://api.minimax.io/v1` | OpenAI-compat chat-completions |
| LLM (vision) | MiniMax MCP `understand_image` | `uvx minimax-coding-plan-mcp` subprocess inside the backend Pod |
| Public ingress | Tailscale Serve → host port 80 → Traefik → Service | TLS terminated by Tailscale at the edge |

## First-time setup

### 1. Tailscale on the host

`tailscale` is already running on Dalekdefender (interface `tailscale0`). Confirm:

```bash
tailscale status | head -2
```

Note the hostname (looks like `dalekdefender.<tailnet>.ts.net`). That's what you'll register with BotFather and what your tailnet devices will hit.

### 2. Bot setup (one-time, in @BotFather Telegram chat)

```
/setdomain
<pick your bot>
dalekdefender.<your-tailnet>.ts.net
```

This whitelists the Tailscale hostname for the Telegram Login Widget. Without it the dashboard's login button posts get rejected.

### 3. Clone and deploy

```bash
git clone https://github.com/Bahuleyandr/khata.git ~/khata
cd ~/khata/deploy

make deploy             # builds both images, imports into k3s containerd, applies manifests
make secrets            # interactive prompts for each secret (one-time)
make migrate            # one-time per fresh DB
make tailscale-serve    # binds https://<your-host>.<tailnet>.ts.net to localhost:80
make status             # verify everything is Running and Tailscale Serve is bound
```

### 4. Sanity check

From any tailnet device:

```bash
curl https://dalekdefender.<your-tailnet>.ts.net/health
# {"status":"ok","db":"ok"}
```

Open `https://dalekdefender.<your-tailnet>.ts.net/` in a browser → click the Telegram login button → log in → see the dashboard. Send the bot a `$45 lunch` message → it should log + reply within ~1–2 seconds.

## Day-to-day

After backend or frontend code changes:

```bash
# Push from your dev machine
git push

# On Dalekdefender
cd ~/khata && git pull && cd deploy && make deploy
```

Both images get rebuilt and re-imported; the deployments roll restart automatically.

## Reference

| Command | What it does |
|---|---|
| `make build` | Build backend and frontend Docker images |
| `make import` | Load both images into k3s containerd (no external registry needed) |
| `make deploy` | Build + import + apply manifests + rollout restart |
| `make secrets` | Interactive create of `khata-secrets` Secret |
| `make migrate` | Apply pending Postgres schema migrations |
| `make logs` | Tail backend logs (look for `LLM ` lines for per-call usage) |
| `make status` | `kubectl get all -n khata` + ingress + tailscale serve status |
| `make restart` | Restart both deployments |
| `make undeploy` | **Destructive.** Delete the entire `khata` namespace. |
| `make tailscale-serve` | Bind Tailscale Serve to `localhost:80` (one-time) |
| `make tailscale-status` | Show current `tailscale serve` config |

## Notes & assumptions

- **k3s default Traefik ingress controller is enabled.** Verify with `kubectl -n kube-system get svc traefik` — should show a LoadBalancer with port 80. If you ran k3s with `--disable=traefik`, this won't pick up our Ingress.
- **k3s Klipper service-LB** binds Traefik to host port 80 so Tailscale Serve can forward to `localhost:80`. This is on by default.
- **Local-path-provisioner** for the Postgres PVC. Default in k3s.
- **No public IPv4 needed.** Tailscale Serve only exposes the dashboard to other devices on your tailnet.
- **No Cloudflare, no public DNS, no Let's Encrypt dance.** Tailscale handles all of it.
- **MCP subprocess** lives inside the backend Pod. First call after a fresh Pod start has ~1s extra latency for `uvx` warmup; subsequent calls are fast (cached package).

## Backups (TODO)

Postgres data is on a single PVC on Dalekdefender's NVMe. No automated backups yet. Recommended: nightly `pg_dump` cron shipping to R2 — will add as a follow-up.

## Switching the model on a per-intent basis

All five LLM intents have an env-var override. Set in the cluster Secret to flip without code changes:

```bash
kubectl set env deployment/khata-backend -n khata \
  MODEL_PARSE_EXPENSE=MiniMax-M2.7 \
  MODEL_NORMALIZE_TRANSACTIONS=MiniMax-M2.7-highspeed
```

Vision intents (`extractTextFromImage`, `ocrReceiptImage`) always go through the MCP `understand_image` tool — no model selection there.
