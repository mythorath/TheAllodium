# The Allodium

Cloudflare Worker + D1 public index for psychotherapy resources.
Source corpus remains in `/tank/ACT`; this repo serves the public artifact.

## Phase 1A

Publication contract + local/remote D1 risk spike. See:

- [docs/publication-contract-v1.md](docs/publication-contract-v1.md)
- [phase_1_roadmap.md](phase_1_roadmap.md)
- [docs/phase-1a-decision-record.md](docs/phase-1a-decision-record.md)

## Phase 1C

Thin vertical slice on staging: the same routes/search proven in 1A, now
validated against a real (non-synthetic) representative sample of ACT data.
See [docs/phase-1c-decision-record.md](docs/phase-1c-decision-record.md).

`fixtures/staging_sample.sql` is a **generated artifact copied from ACT**,
not hand-authored. To regenerate it:

```bash
# In /tank/ACT:
.venv/bin/python3 scripts/export_allodium_staging_sample.py

# Copy the newest exports/allodium/psychotherapy/staging-sample-*/ output into TheAllodium:
cp /tank/ACT/exports/allodium/psychotherapy/staging-sample-<TIMESTAMP>/import.sql fixtures/staging_sample.sql
cp /tank/ACT/exports/allodium/psychotherapy/staging-sample-<TIMESTAMP>/manifest.json fixtures/staging_sample.manifest.json
cp /tank/ACT/exports/allodium/psychotherapy/staging-sample-<TIMESTAMP>/checksum.txt fixtures/staging_sample.checksum.txt

# Then re-run the local test suite and (optionally) reload staging:
npm test
npm run db:load:staging-sample
npm run db:smoke:staging-sample
npm run gate:1c
```

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
| `npm run db:load:staging-sample` | Reset + load the real Phase 1C representative sample into remote staging D1 |
| `npm run db:smoke:staging-sample` | Remote smoke checks against the loaded sample (dynamically discovers alias/blocked-link rows) |
| `npm run gate:1c` | Close Phase 1C: secrets scan, typecheck, test, write `docs/phase-1c-decision-record.md` |
