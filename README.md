# The Allodium

Cloudflare Worker + D1 public index for psychotherapy resources.
Source corpus remains in `/tank/ACT`; this repo serves the public artifact.

## Phase 1A

Publication contract + local/remote D1 risk spike. See:

- [docs/publication-contract-v1.md](docs/publication-contract-v1.md)
- [phase_1_roadmap.md](phase_1_roadmap.md)

## Setup

```bash
cp .env.example .env   # if needed; never commit .env
npm install
npm run typecheck
npm test
npm run db:reset:local
npm run db:smoke:local
```

### Remote staging (dedicated D1 only)

```bash
npm run db:create:staging
npm run db:migrate:staging
npm run db:smoke:staging
npm run gate:1a
```

Requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `.env`.
Token needs Account → D1 → Edit. Domain/zone permissions are not required for 1A.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local Vite + Worker |
| `npm test` | Workers-runtime vitest suite |
| `npm run db:reset:local` | Wipe local D1, migrate, load fixture, rebuild FTS |
| `npm run secrets:scan` | Fail if secrets appear outside `.env` |
