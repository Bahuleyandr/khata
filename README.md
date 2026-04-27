# raareerum

Engineering monorepo for RaaReeRum Enterprises.

| Service | Description |
|---|---|
| `/` (root) | Next.js 15 frontend — marketing / dashboard UI |
| `backend/` | Fastify API + Telegram bot — expense tracker ingress |

## Quick start

You need **Node 20** and **npm** installed.

```bash
git clone https://github.com/Bahuleyandr/raareerum.git
cd raareerum
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
- An S3-compatible bucket (Cloudflare R2, MinIO, AWS S3)

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

### Register the Telegram webhook

After deploying, run once to point Telegram at your server:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-backend-host.fly.dev/telegram/webhook",
    "secret_token": "<YOUR_TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Then send `/start` to your bot — it should reply with a hello message.

### Backend scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run lint` | ESLint check |
| `npm test` | Vitest unit tests |

### Deploy to Fly.io

```bash
cd backend
fly launch --no-deploy       # first time only — creates app
fly secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
  ALLOWED_TELEGRAM_USER_IDS=... DATABASE_URL=... \
  S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
fly deploy
```

### Environment variables

See `backend/.env.example` for the full list. Never commit a `.env` file — it is gitignored.

## CI

GitHub Actions runs lint + tests on every push that touches `backend/`. See [`.github/workflows/backend-ci.yml`](.github/workflows/backend-ci.yml).

Pushing CI workflow files requires a token with `workflow` scope:

```bash
gh auth refresh -s workflow
git push origin main
```

## Frontend deploy

The frontend is configured for [Vercel](https://vercel.com) — import the repo and it auto-deploys on every push to `main`.

## Runbook

### Local test run (frontend)

```bash
npm test   # runs vitest in repo root
```

### Local test run (backend)

```bash
cd backend && npm test
```

### Vercel environment variables

Add secrets in the Vercel dashboard under **Project → Settings → Environment Variables**. Do not commit `.env.local` — it is gitignored.
