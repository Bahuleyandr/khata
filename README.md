# khata

Personal expense tracker. Capture spending via Telegram (text, voice notes, photos of receipts, forwarded UPI / bank-card SMS), browse it on a Next.js dashboard. Single-user, India-first (INR), deployed Tailnet-only on homelab k3s.

| Service | Description |
|---|---|
| `/` (root) | Next.js 15 dashboard — transactions, categories, tags, monthly Excel export |
| `backend/` | Fastify API + grammy Telegram bot — capture, parse, classify, store |

## Quick start

You need **Node 20** and **npm** installed.

```bash
git clone https://github.com/Bahuleyandr/khata.git
cd khata
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see a hello-world page.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Serve production build locally |
| `npm run lint` | ESLint check (Next.js core-web-vitals rules) |
| `npm test` | Run Vitest test suite once |
| `npm run test:watch` | Run Vitest in watch mode |

## Project structure

```
app/          Next.js App Router pages and layouts
lib/          Pure utility modules (testable without framework)
  greeting.ts        Example: a pure greeting function
  greeting.test.ts   Vitest test for the greeting function
```

Business logic lives in `lib/` — framework-agnostic, easy to unit test. Pages in `app/` compose from `lib/`.

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
| `npm run lint` | ESLint check |
| `npm test` | Vitest unit tests |

### Deploy

Deployed to **k3s on Dalekdefender** (Ubuntu 26.04, single-node) and accessible only over **Tailscale** — no public DNS, no public ingress. The bot runs in long-polling mode (no webhook), so the deployment uses `strategy: type: Recreate` (Telegram allows only one long-polling client per bot). MiniMax handles every LLM call: text via the OpenAI-compat chat endpoint, vision via the `minimax-coding-plan-mcp` MCP server (`understand_image` tool) running as a subprocess inside the backend Pod. Voice notes transcribe locally via `whisper.cpp` (ggml-tiny) baked into the image, with `ffmpeg` converting Telegram OGG/Opus to 16 kHz mono WAV. Receipt blobs live in an in-cluster MinIO and are served to the dashboard through an authenticated `/api/receipts/:id/image` proxy route (no presigned URLs).

Setup, manifests, and the day-to-day `make deploy` flow live in [deploy/README.md](deploy/README.md).

### Environment variables

See `backend/.env.example` for the full list. Never commit a `.env` file — it is gitignored.

## CI

GitHub Actions runs lint + tests on every push that touches `backend/`. See [`.github/workflows/backend-ci.yml`](.github/workflows/backend-ci.yml).

> **Note (2026-04):** GHA on this account is currently billing-blocked, so every workflow run fails before it starts. **Red checks are not a code signal** — verification is local:
>
> ```bash
> npm ci && npm run lint && npm test -- --run        # frontend
> cd backend && npm ci && npm run lint && npm test && npm run build
> ```

Pushing CI workflow files requires a token with `workflow` scope:

```bash
gh auth refresh -s workflow
git push origin main
```

## Frontend deploy

**Deployed in-cluster** alongside the backend on Dalekdefender — built into a Docker image (multi-stage: Next.js static export → nginx). Path routing happens **inside the frontend Pod's nginx**: it serves the static export at `/` and reverse-proxies `/api/*` + `/health` to the `khata-backend` Service. Tailscale Serve binds the Pod's port 80 to the VIP service `khata.hippocampus-monitor.ts.net`, which is distinct from the box's apex tailnet hostname (so it doesn't collide with other workloads on Dalekdefender). See [deploy/Dockerfile.frontend](deploy/Dockerfile.frontend) and [deploy/k8s/40-frontend.yaml](deploy/k8s/40-frontend.yaml). `next.config.ts` stays locked to `output: 'export'`.

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
