# raareerum

Engineering scaffold for RaaReeRum Enterprises — a Next.js 15 + TypeScript monorepo.

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

## CI

GitHub Actions runs lint + tests on every pull request and push to `main`. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) once the workflow file is pushed (requires a GitHub token with `workflow` scope — see Runbook below).

## Deploy

This project is configured for [Vercel](https://vercel.com). To connect:

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `Bahuleyandr/raareerum` repository
3. Vercel auto-detects Next.js — click **Deploy**
4. Every push to `main` will trigger a production deploy automatically

The `vercel.json` in the root declares the framework and sets the Node version.

## Runbook

### Unblock GitHub Actions workflow push

The GitHub OAuth token used by the CLI must have `workflow` scope to push files under `.github/workflows/`. Run:

```bash
gh auth refresh -s workflow
cd /tmp/raareerum
git push origin main
```

This will open a browser for scope approval. After approval the CI workflow will land on `main` and run automatically.

### Local test run

```bash
npm test
# runs: vitest run
# exits 0 if all tests pass
```

### Vercel environment variables

Add secrets in the Vercel dashboard under **Project → Settings → Environment Variables**. Do not commit `.env.local` — it is gitignored.
