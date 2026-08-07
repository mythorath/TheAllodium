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

## Phase 1D

Deterministic full-snapshot generation, pure-Python preflight validation, and
a D1 Time-Travel-backed promote/rollback pipeline that pushes the complete
catalog through staging into a real production D1 without hand-edited SQL.
See [docs/phase-1d-decision-record.md](docs/phase-1d-decision-record.md).

`fixtures/full_snapshot.sql` is a **generated artifact copied from ACT**, not
hand-authored. To regenerate it:

```bash
# In /tank/ACT:
.venv/bin/python3 scripts/export_allodium_snapshot.py

# Copy the newest exports/allodium/psychotherapy/<TIMESTAMP>/ output into TheAllodium:
cp /tank/ACT/exports/allodium/psychotherapy/<TIMESTAMP>/import.sql fixtures/full_snapshot.sql
cp /tank/ACT/exports/allodium/psychotherapy/<TIMESTAMP>/manifest.json fixtures/full_snapshot.manifest.json
cp /tank/ACT/exports/allodium/psychotherapy/<TIMESTAMP>/checksum.txt fixtures/full_snapshot.checksum.txt

# Then re-run the local test suite and promote:
npm test
npm run db:promote:staging
npm run db:promote:production   # requires --yes, baked into the script
npm run gate:1d
```

To roll a database back to the state immediately before its most recent
promotion (proven against real staging infrastructure — see the decision
record):

```bash
npm run db:rollback:staging      # or db:rollback:production
```

Every promotion and rollback appends an immutable record to the git-tracked
`deployments/log.json`.

## Phase 1E

Public beta experience: a real `/standard/` methodology page backed by live
`coverage_json`, `/disclaimer` with crisis routing, accessibility/responsive
polish, honest error/empty states, and a Playwright + axe-core smoke suite.
See [docs/phase-1e-decision-record.md](docs/phase-1e-decision-record.md).

```bash
npm test               # Workers-runtime vitest suite
npm run test:e2e       # resets local D1, then runs the Playwright/axe suite
npm run gate:1e
```

The e2e suite runs against `npm run dev` (Miniflare-backed) using the same
local D1 spike fixture as the Vitest suite — see `playwright.config.ts` and
`e2e/routes.spec.ts`.

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

### Remote production (dedicated D1 only, no public domain yet)

```bash
npm run db:create:production
npm run db:promote:production
```

Same token scope as staging. Creates `theallodium-psychotherapy-production`
and loads the full snapshot into it — the Worker is not deployed against it
until Phase 1F.

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
| `npm run db:create:production` | Create the real `theallodium-psychotherapy-production` D1 and wire it into `wrangler.jsonc` |
| `npm run db:promote:staging` / `db:promote:production` | Verify checksum, apply migrations, capture a Time Travel bookmark, atomically replace content, smoke-check, log the deployment |
| `npm run db:rollback:staging` / `db:rollback:production` | Restore to the bookmark captured before that env's last promotion, re-verify, log the rollback |
| `npm run gate:1d` | Close Phase 1D: secrets scan, typecheck, test, verify deployment log, write `docs/phase-1d-decision-record.md` |
| `npm run test:e2e` | Reset local D1, then run the Playwright + axe-core accessibility/route/search suite |
| `npm run gate:1e` | Close Phase 1E: secrets scan, typecheck, test, e2e suite, write `docs/phase-1e-decision-record.md` |
