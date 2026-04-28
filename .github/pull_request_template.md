## What changed

-

## Local verification

- [ ] `npm run secrets:scan`
- [ ] `npm run lint && npm test && npm run build`
- [ ] `cd backend && npm run lint && npm test && npm run build`

## Data safety

- [ ] Migrations are idempotent and safe to re-run
- [ ] Money/date/category changes have tests or a manual verification note
- [ ] No real `.env`, bot token, API key, S3 key, or private key is committed

## Deploy notes

- [ ] `deploy/Makefile` changes were smoke-checked or are docs-only
- [ ] Any required secret or backup change is documented in `deploy/README.md`
