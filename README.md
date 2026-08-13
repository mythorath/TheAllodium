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

## Phase 1F

Launch readiness: JSON-LD, a live `/sitemap.xml`, `robots.txt`/`llms.txt`,
security/caching headers, a production deploy bound to the
`theallodium.org` Custom Domain, a `theallodium.com` → `theallodium.org`
redirect, real HTTP-level smoke tests against the live edge, and a rollback
runbook. See [docs/phase-1f-decision-record.md](docs/phase-1f-decision-record.md)
and [docs/rollback-runbook.md](docs/rollback-runbook.md).

```bash
npm run deploy:staging
npm run smoke:live -- --url https://theallodium-staging.theallodium.workers.dev

npm run deploy:production          # requires --yes, baked into the script
npm run configure:com-redirect     # requires --yes, baked into the script
npm run smoke:live -- --url https://theallodium.org

npm run gate:1f
```

### Continuous link-integrity monitoring

`scripts/cron-audit-links.sh` runs `npm run audit:links -- --url https://theallodium.org --env production`
on a schedule (installed via this machine's crontab: `0 8 * * *`, i.e. daily
at 08:00) and appends every run's pass/fail result to
`evidence/cron-audit-links.log`, so link-order drift or a self-consistency
regression in production is caught continuously going forward rather than
only when someone happens to run the audit by hand. Re-install after moving
the checkout or upgrading node (`NODE_BIN_DIR` in the script is a fixed
path):

```bash
(crontab -l 2>/dev/null; echo "0 8 * * * /tank/TheAllodium/scripts/cron-audit-links.sh") | crontab -
```

`deploy:production` and `configure:com-redirect` need a `CLOUDFLARE_API_TOKEN`
with Zone-level permissions in addition to the Account-level ones used by
earlier phases — Cloudflare API tokens scope Account and Zone permissions
independently, so full Account access does **not** imply any Zone access.
Add, scoped to `theallodium.org` and `theallodium.com` specifically:

- Zone → Workers Routes → Edit, on `theallodium.org` (for the Custom Domain attach on deploy)
- Zone → Zone → Read, on both
- Zone → Single Redirect → Edit, on `theallodium.com` (for the redirect rule)
- Zone → DNS → Edit, on `theallodium.com` (a zone with zero DNS records has
  no hostname for Cloudflare's edge to route requests to at all —
  `configure-com-redirect.ts` also provisions a placeholder proxied A
  record there, idempotently, before applying the redirect rule)

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
| `npm run deploy:staging` / `deploy:production` | Pre-flight checks, refuse to deploy against an empty D1, `wrangler deploy`, log the Version ID to `deployments/log.json` |
| `npm run configure:com-redirect` | Idempotently PUT the `theallodium.com` → `theallodium.org` zone-level redirect rule |
| `npm run smoke:live -- --url <base>` | Real HTTP-level checks against a deployed Worker (headers, sitemap/manifest parity, 404s, no cookies, and the `.com` redirect when `--url` is the production domain) |
| `npm run audit:links -- --url <base> [--env staging\|production]` | Real HTTP-level link-integrity audit: double-fetches a sample of live entry pages (plus every duplicate-titled "tie-risk" entry when `--env` gives D1 access) to prove id/title/canonical_url stay self-consistent, and checks that every sort's search/browse pagination has no duplicate/missing ids and a stable order across repeated requests. Run against staging and production after every deploy, alongside `smoke:live` |
| `npm run diff:links -- --env staging\|production [--snapshot <name>] [--acknowledge]` | Cross-snapshot stability check: diffs the new `fixtures/<name>.sql` about to be promoted against the currently-live entries in `--env`, and fails if any id's `title`/`canonical_url` would silently change. Runs automatically as part of `db:promote:*` (pass `--acknowledge-link-changes` to that command once a flagged change is confirmed intentional) |
| `npm run gate:1f` | Close Phase 1F: secrets scan, typecheck, test, e2e suite, verify a production deploy + passing live smoke evidence exist, write `docs/phase-1f-decision-record.md` |
