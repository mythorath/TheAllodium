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
promotion (proven against real staging infrastructure. See the decision
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
local D1 spike fixture as the Vitest suite. See `playwright.config.ts` and
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
only when someone happens to run the audit by hand. After the link audit it
also runs `npm run smoke:gpu` and appends pass/fail to
`evidence/cron-gpu-health.log`. That GPU check is **non-fatal** (Selis
asleep is expected) and must not fail the daily job. Re-install is not
required if the same crontab already calls this script; the next 08:00 run
picks the GPU log up. Re-install after moving the checkout or upgrading
node (`NODE_BIN_DIR` in the script is a fixed path):

```bash
(crontab -l 2>/dev/null; echo "0 8 * * * /tank/TheAllodium/scripts/cron-audit-links.sh") | crontab -
```

`deploy:production` and `configure:com-redirect` need a `CLOUDFLARE_API_TOKEN`
with Zone-level permissions in addition to the Account-level ones used by
earlier phases: Cloudflare API tokens scope Account and Zone permissions
independently, so full Account access does **not** imply any Zone access.
Add, scoped to `theallodium.org` and `theallodium.com` specifically:

- Zone → Workers Routes → Edit, on `theallodium.org` (for the Custom Domain attach on deploy)
- Zone → Zone → Read, on both
- Zone → Single Redirect → Edit, on `theallodium.com` (for the redirect rule)
- Zone → DNS → Edit, on `theallodium.com` (a zone with zero DNS records has
  no hostname for Cloudflare's edge to route requests to at all,
  `configure-com-redirect.ts` also provisions a placeholder proxied A
  record there, idempotently, before applying the redirect rule)

Phase 3A (`configure:gpu-tunnel`) additionally needs:

- Zone → DNS → Edit, on `theallodium.org` (CNAME for `gpu.theallodium.org`
  onto the existing Cloudflare Tunnel)
- Account → Cloudflare Tunnel → Edit (ingress PUT on `mythsmind-backend`;
  GET already worked with Read, but the merge-PUT needs Edit)

Phase 3C (`configure:ask-ratelimit`) additionally needs:

- Zone → WAF → Edit, on `theallodium.org` (rate-limiting rules live under
  WAF). Confirm with a GET of
  `/zones/{id}/rulesets/phases/http_ratelimit/entrypoint` before PUT.

`configure:bot-access` additionally needs:

- Zone → Bot Management → Edit, on `theallodium.org` (Super Bot Fight Mode
  and AI-bot protection live under Bot Management). Confirm with a GET of
  `/zones/{id}/bot_management` before PUT.

Phase 3B (`?ask=` NL search) needs a **shared secret**, not extra Cloudflare
token scopes. This is **not** `CLOUDFLARE_API_TOKEN`:

- `ALLODIUM_GPU_TOKEN` in `/etc/allodium-gpu.env` (`chmod 600`), loaded by
  `allodium-gpu-api.service` via `EnvironmentFile`
- `GPU_SHARED_SECRET` via `npx wrangler secret put GPU_SHARED_SECRET --env staging`
  and `--env production` (same value). Local/tests leave it unset so `askGpu`
  fails closed without hitting the live GPU.

## Phase 5: The Open Index

`/open-index` and `/search` add an all-fields federated research index without
copying the complete scholarly graph into D1. Ten isolated adapters cover
Crossref, Europe PMC, DataCite, PubMed, DOAJ, Zenodo, HAL, arXiv, DOAB, and
DBLP; eight are enabled in public fan-out. Zenodo and DBLP are monitored but
disabled after their origins blocked Cloudflare egress (Zenodo 403; DBLP
Anubis HTML). Results are
merged by normalized DOI and a fallback
title/first-author/year identity, then shown with expandable, versioned
credibility signals.

The `AUTHORITY` D1 binding is separate from the curated psychotherapy
database. It holds only redistributable venue, institution, field-taxonomy,
and retraction authority snapshots. `SEARCH_CACHE` and
`UPSTREAM_RATE_LIMITER` provide edge caching and globally coordinated
upstream politeness. Any adapter or authority failure becomes explicit
uncertainty or partial results, never a fabricated negative judgment.

```bash
npm run spike:federation -- --output evidence/federation-spike-local.json
npm run audit:federation

python3 scripts/fetch-authority-sources.py --help
python3 scripts/build-authority-snapshot.py --help
npm run authority:migrate:local

npm run gate:5a   # through gate:5h
```

### Federated overviews (resumable)

Cached 2–4 sentence paraphrases live in `AUTHORITY.federated_work_overviews`
and survive authority snapshot promotes. The Worker never sees source
abstracts. Partial rows are safe: a work page with no overview simply omits
the section.

State lives in `/mnt/smesh/allodium-verify/` (`hub-pages.jsonl`,
`doi-queue.jsonl`). Re-running the same command skips already-written URLs and
DOIs.

```bash
# Crawl the live browse web (Pass A) then resolve /works pages (Pass B).
# ~520k sitemap URLs; hours to days. Safe to interrupt and resume.
npm run verify:browse -- --url https://theallodium.org --env production

# When the LAN 5090 Ollama box is up (http://10.10.10.2:11435):
python3 scripts/generate_federated_overviews.py \
  --doi-queue /mnt/smesh/allodium-verify/doi-queue.jsonl \
  --dry-run --limit 3

python3 scripts/generate_federated_overviews.py \
  --doi-queue /mnt/smesh/allodium-verify/doi-queue.jsonl \
  --env staging --limit 20

python3 scripts/generate_federated_overviews.py \
  --doi-queue /mnt/smesh/allodium-verify/doi-queue.jsonl \
  --env production --yes
```

See [docs/federation-contract-v1.md](docs/federation-contract-v1.md),
[docs/authority-data.md](docs/authority-data.md),
[docs/credibility-standard-v1.md](docs/credibility-standard-v1.md),
[docs/open-index-coverage.md](docs/open-index-coverage.md),
[docs/collection-module-contract-v1.md](docs/collection-module-contract-v1.md),
and [docs/collection-two-playbook.md](docs/collection-two-playbook.md).

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
and loads the full snapshot into it. The Worker is not deployed against it
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
| `npm run configure:gpu-tunnel` | Idempotently add `gpu.theallodium.org` ingress + CNAME on the existing `mythsmind-backend` tunnel (GET-merge-PUT; never drops `api.mythsmind.com`) |
| `npm run configure:ask-ratelimit` | Idempotently GET-merge-PUT a zone WAF rate-limit rule on `theallodium.org` for `/psychotherapy/search` (requested: `?ask=` only, 20 req / 60s / IP, block 429; falls back to the zone plan's entitled period/fields) |
| `npm run configure:bot-access` | Idempotently GET-merge-PUT Super Bot Fight Mode on `theallodium.org` so automated traffic and AI crawlers are allowed (`sbfm_definitely_automated=allow`, `ai_bots_protection=disabled`, JS detections off) |
| `npm run smoke:gpu` | `GET https://gpu.theallodium.org/api/health`; pass on HTTP 200 with `status` `ok` or `degraded`; write `evidence/gpu-smoke.json` |
| `npm run gate:3a` | Close Phase 3A: secrets scan, typecheck, test, e2e suite, require live GPU health evidence, write `docs/phase-3a-decision-record.md` |
| `npm run gate:3b` | Close Phase 3B: secrets scan, typecheck, test, e2e suite, write `docs/phase-3b-decision-record.md` |
| `npm run gate:3c` | Close Phase 3C: secrets scan, typecheck, test, e2e suite, require rate-limit + GPU smoke + production live-smoke evidence, write `docs/phase-3c-decision-record.md` |
| `npm run smoke:live -- --url <base>` | Real HTTP-level checks against a deployed Worker (headers, sitemap/manifest parity, 404s, no cookies, and the `.com` redirect when `--url` is the production domain) |
| `npm run audit:links -- --url <base> [--env staging\|production]` | Real HTTP-level link-integrity audit: double-fetches a sample of live entry pages (plus every duplicate-titled "tie-risk" entry when `--env` gives D1 access) to prove id/title/canonical_url stay self-consistent, and checks that every sort's search/browse pagination has no duplicate/missing ids and a stable order across repeated requests. Run against staging and production after every deploy, alongside `smoke:live` |
| `npm run diff:links -- --env staging\|production [--snapshot <name>] [--acknowledge]` | Cross-snapshot stability check: diffs the new `fixtures/<name>.sql` about to be promoted against the currently-live entries in `--env`, and fails if any id's `title`/`canonical_url` would silently change. Runs automatically as part of `db:promote:*` (pass `--acknowledge-link-changes` to that command once a flagged change is confirmed intentional) |
| `npm run gate:1f` | Close Phase 1F: secrets scan, typecheck, test, e2e suite, verify a production deploy + passing live smoke evidence exist, write `docs/phase-1f-decision-record.md` |
| `npm run verify:browse` | Crawl the live browse web into resumable `hub-pages.jsonl` / `doi-queue.jsonl` (default state dir `/mnt/smesh/allodium-verify/`) |
| `npm run authority:fetch` / `authority:build` | Fetch approved public authority sources and build deterministic `import.sql`, manifest, license, and checksum artifacts |
| `npm run authority:promote:staging` / `authority:promote:production` | Checksum, migrate, Time-Travel bookmark, atomically import, smoke-check, and log an authority snapshot |
| `npm run authority:rollback:staging` / `authority:rollback:production` | Restore the authority database to its pre-promotion Time Travel bookmark |
| `npm run authority:publish:r2` / `authority:publish:zenodo` | Publish the licensed bulk bundle to R2 and its metadata/checksum record to Zenodo |
| `npm run gate:5a` … `gate:5h` | Verify and close each independently shippable Open Index sub-phase |
| `npm run collection:validate -- --dir <path>` | Validate a collection module bundle (contract v2 rows, checksums, static analysis) and write `evidence/collection-validate-<slug>.json` |
| `npm run collection:install -- --dir <path>` | After validate: copy the bundle in-repo, patch `wrangler.jsonc`, register `src/contributed/<slug>`, create staging D1 (`--yes` also creates production; `--skip-remote` skips Cloudflare) |
| `npm run collection:pack-kit` | Package `collection-kit/` plus the minerals example as `collection-kit/allodium-collection-kit.tgz` |
