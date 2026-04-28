# khata

Personal expense tracker. Capture spending via Telegram (text, voice notes, photos of receipts, forwarded UPI / bank-card SMS), browse it on a Next.js dashboard. Single-user, India-first (INR), deployed Tailnet-only on homelab k3s.

| Service | Description |
|---|---|
| `/` (root) | Next.js 15 dashboard — transactions, categories, tags, monthly Excel export |
| `backend/` | Fastify API + grammy Telegram bot — capture, parse, classify, store |

## Quick start

You need **Node 22**, **npm**, and Docker or WSL Docker for the local Postgres/migration smoke path.

```bash
git clone https://github.com/Bahuleyandr/khata.git
cd khata
npm install
npm --prefix backend install
```

Backend setup:

```bash
cd backend
cp .env.example .env
# Fill TELEGRAM_BOT_TOKEN, ALLOWED_TELEGRAM_USER_IDS, SESSION_SECRET, DATABASE_URL,
# MiniMax, and S3/MinIO values in .env.

docker run -d --name khata-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=khata \
  -p 5432:5432 \
  postgres:16-alpine

npm run migrate:dev
npm run dev
```

Frontend setup in another terminal:

```bash
cd khata
echo NEXT_PUBLIC_API_URL=http://localhost:3001 > .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The current app should show the Telegram login shell, then the dashboard, transactions, receipts, and manage workspace after auth.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Serve production build locally |
| `npm run lint` | ESLint check (Next.js core-web-vitals rules) |
| `npm test` | Run Vitest test suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run migration:smoke` | Apply all SQL migrations to a disposable Postgres container |
| `npm run e2e` | Run Playwright smoke coverage for desktop and mobile dashboard flows |
| `npm run premerge` | Run root verify, backend verify, migration smoke, and Playwright smoke |

## Project structure

```
app/          Next.js App Router dashboard, transactions, receipts, and manage pages
lib/          Shared frontend API client, formatting, auth, and utility modules
backend/      Fastify API, Telegram bot handlers, migrations, parsing, and cron jobs
deploy/       k3s manifests, Dockerfiles, backups, and Dalekdefender make targets
tests/e2e/    Playwright smoke tests with mocked dashboard APIs
```

Frontend business logic lives in `lib/` where possible. Backend money/data logic lives under `backend/src/` and is covered by Vitest plus the migration smoke test.

## Stack rationale

**Next.js 15 + React 19 + TypeScript 5** — chosen under the Reversibility lens: Next.js supports static HTML export, server-side rendering, and serverless edge functions without rewriting application code. As the product direction evolves we can adopt the deploy model that fits best without touching business logic.

**Vitest** — ESM-native, fast, and compatible with the Next.js TypeScript config out of the box.

**ESLint 9 flat config** — Next.js `core-web-vitals` rule set keeps the linter aligned with production constraints.

**Single monorepo** — keeps operational overhead minimal at this stage. Polyrepo can be introduced if domain isolation warrants it later.

## Backend — expense tracker API + Telegram bot

### Prerequisites

- Node 22, npm
- Docker (for local Postgres) — or a running Postgres instance
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An S3-compatible bucket — MinIO is bundled in the k3s deploy; locally, any S3-compatible store works (point `S3_*` env vars at it)

### Local dev setup

```bash
cd backend
cp .env.example .env
# Fill in values in .env

# Start Postgres locally (Docker)
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine

# Install deps
npm install

# Run migrations
npm run migrate

# Start dev server (hot-reload)
npm run dev
# Server listens on http://localhost:3001
# Health check: curl http://localhost:3001/health
```

### Backend scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run migrate:dev` | Apply pending SQL migrations from TypeScript during local dev |
| `npm run lint` | ESLint check |
| `npm test` | Vitest unit tests |

### Deploy

Deployed to **k3s on Dalekdefender** (Ubuntu 26.04, single-node) and accessible only over **Tailscale** — no public DNS, no public ingress. The bot runs in long-polling mode (no webhook), so the deployment uses `strategy: type: Recreate` (Telegram allows only one long-polling client per bot). MiniMax handles every LLM call: text via the OpenAI-compat chat endpoint, vision via the `minimax-coding-plan-mcp` MCP server (`understand_image` tool) running as a subprocess inside the backend Pod. Voice notes transcribe locally via `whisper.cpp` (ggml-tiny) baked into the image, with `ffmpeg` converting Telegram OGG/Opus to 16 kHz mono WAV. Receipt blobs live in an in-cluster MinIO and are served to the dashboard through an authenticated `/api/receipts/:id/image` proxy route (no presigned URLs).

Setup, manifests, and the day-to-day `make deploy` flow live in [deploy/README.md](deploy/README.md).

### Environment variables

See `backend/.env.example` for the full list. Never commit a `.env` file — it is gitignored.

## CI and local guardrails

GitHub Actions defines frontend CI, backend CI, and a standalone tracked-file secret scan. Dependabot is configured for root npm, backend npm, Dockerfiles, and GitHub Actions.

> **Note (2026-04):** GHA on this account is currently billing-blocked, so every workflow run fails before it starts. **Red checks are not a code signal** — verification is local:
>
> ```bash
> npm ci
> npm --prefix backend ci
> npm run hooks:install
> npm run premerge
> ```

The tracked pre-push hook blocks accidental direct pushes to `main` and runs the secret scanner before pushes. GitHub branch protection is still recommended when available for the repository plan.

Pushing CI workflow files requires a token with `workflow` scope:

```bash
gh auth refresh -s workflow
git push origin main
```

## Frontend deploy

**Deployed in-cluster** alongside the backend on Dalekdefender — built into a Docker image (multi-stage: Next.js static export → nginx). Path routing happens **inside the frontend Pod's nginx**: it serves the static export at `/` and reverse-proxies `/api/*` + `/health` to the `khata-backend` Service. Tailscale Serve binds the Pod's port 80 to the VIP service `khata.hippocampus-monitor.ts.net`, which is distinct from the box's apex tailnet hostname (so it doesn't collide with other workloads on Dalekdefender). See [deploy/Dockerfile.frontend](deploy/Dockerfile.frontend) and [deploy/k8s/40-frontend.yaml](deploy/k8s/40-frontend.yaml). `next.config.ts` stays locked to `output: 'export'`.

## PWA / installable app

The dashboard ships as a Progressive Web App. `app/manifest.ts` emits `/manifest.webmanifest`, `public/sw.js` is a network-first service worker (API requests pass through untouched — never serve stale expense data), and `public/icons/icon.svg` is the dark-background ₹ tile that Android crops into a circle and iOS into a squircle.

**Install on a phone:**
- iOS Safari: tap the Share sheet → *Add to Home Screen*
- Android Chrome: three-dot menu → *Install app*

The installed app launches in standalone mode (no browser chrome) and opens at `/` (which routes to `/login` or `/dashboard` based on session).

### Optional: public access via Tailscale Funnel

The default deploy is Tailnet-only — fine when every viewer has Tailscale. To make the dashboard reachable from devices that *don't* have Tailscale (e.g., a partner's phone where you don't want to install Tailscale), enable **Tailscale Funnel** on Dalekdefender:

```bash
# On Dalekdefender — exposes the existing Tailscale-Serve config to the public internet.
# Same hostname (khata.hippocampus-monitor.ts.net), now publicly resolvable + TLS-terminated by Tailscale.
sudo tailscale funnel --bg 443 on
```

After that, the URL works from any device with no Tailscale needed. Auth still gates entry — Telegram-Login + the `ALLOWED_TELEGRAM_USER_IDS` allowlist + the existing session cookie. The bot token signature in the Telegram-Login flow makes brute-forcing infeasible; the allowlist ensures only specifically-permitted Telegram IDs ever get a session.

To turn Funnel back off:

```bash
sudo tailscale funnel --bg 443 off
```

## Telegram Mini App

The dashboard also runs as a **Telegram Mini App** — a webview embedded directly in Telegram, with auto-auth via the WebApp `initData` query-string. No separate login screen, no Tailscale on the user's phone. The capture surface (the bot) and the review surface (the dashboard) live in one place.

**Setup (one-time, on the backend):**
1. Make sure the dashboard URL is **publicly reachable** — see the Tailscale Funnel step above. Telegram's webview loads the URL on the user's device, so a Tailnet-only URL won't work for users outside the tailnet.
2. Set `MINI_APP_URL` in `khata-secrets`:
   ```bash
   kubectl edit secret khata-secrets -n khata
   # add: MINI_APP_URL=https://khata.hippocampus-monitor.ts.net
   kubectl rollout restart deployment/khata-backend -n khata
   ```
3. The bot will register a global chat menu button on startup. Users see a "Dashboard" button next to the message input in the bot's chat.

**Open the Mini App:** tap the menu button next to the bot's chat input, or send `/dashboard` and tap the inline "Open Dashboard" button. The dashboard opens inside Telegram, auto-authenticated as the Telegram user — same allowlist, same session cookie as the OAuth path.

**Auth model:** the WebApp `initData` is HMAC-signed by Telegram with the bot token. `verifyWebAppInitData` ([backend/src/auth/telegram-webapp.ts](backend/src/auth/telegram-webapp.ts)) validates the signature server-side, then enforces the `ALLOWED_TELEGRAM_USER_IDS` allowlist before issuing a session cookie. Only initData younger than 24h is accepted.

## Security notes

Dashboard sessions are HMAC-signed, HTTP-only cookies. Session verification re-checks `ALLOWED_TELEGRAM_USER_IDS`, so removing a Telegram ID invalidates its next request even before the cookie expires. Logout calls `POST /api/logout` and clears the cookie server-side.

Mutating dashboard APIs (`POST`, `PATCH`, `PUT`, `DELETE`) are protected by an Origin guard before route handlers run. Same-host requests are accepted for the production Tailscale hostname; explicitly configured `ALLOWED_ORIGINS` are accepted for local/dev flows. Other browser origins receive `403 Cross-site request blocked`. The cookie is `sameSite: none` in production to support Telegram webview/Mini App behavior, so keep the Origin guard in place for any new mutating dashboard route.

## Runbook

### Local test run (frontend)

```bash
npm test   # runs vitest in repo root
```

### Local test run (backend)

```bash
cd backend && npm test
```

### Environment variables

Do not commit `.env.local` — it is gitignored. The static export (`output: 'export'`) has no server runtime, so secrets are not needed for the deployed site.
