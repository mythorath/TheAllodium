# Rollback runbook

The Allodium has two independent things that can need rolling back, and they
are rolled back by two entirely different mechanisms — don't conflate them.

1. **Code** (the Worker script — routes, views, middleware): rolled back
   with `wrangler rollback`.
2. **Data** (the D1 database content — entries, tags, manifest): rolled
   back with D1 Time Travel, via this project's own
   `db:rollback:staging` / `db:rollback:production` scripts.

A bad release is usually one or the other, not both — check
`deployments/log.json` (the audit trail every `deploy-worker.ts` /
`promote-snapshot.ts` run writes to) to see which kind of change happened
most recently before deciding which rollback to run.

## 1. Code rollback

Every `npm run deploy:staging` / `npm run deploy:production` records a
Worker Version ID in `deployments/log.json` (`"type": "deploy"`). To roll
back to a previous version:

```bash
# See recent versions (or deployments) for the target environment
npx wrangler versions list --env production
npx wrangler deployments list --env production

# Roll back to a specific known-good version ID
npx wrangler rollback <version-id> --env production -m "Rolling back: <why>"
```

`wrangler rollback` immediately makes `<version-id>` the active version for
that environment — no rebuild, no redeploy, seconds not minutes. It does
**not** touch D1 data. Use `deployments/log.json` or
`wrangler versions list` to find the `<version-id>` of the last known-good
deploy (the deploy immediately before the one you're rolling back from).

Staging: same commands with `--env staging`.

## 2. Data rollback

Every `npm run db:promote:staging` / `db:promote:production` captures a D1
Time Travel bookmark **before** it touches any content, and records it in
`deployments/log.json` (`"type": "promote"`, field `preBookmark`). To
restore a database to the state immediately before its most recent
promotion:

```bash
npm run db:rollback:staging     # restores to before the last promote to staging
npm run db:rollback:production  # restores to before the last promote to production
```

Both require `--yes` (already baked into the npm script) since they
destructively overwrite the target database's current content. Each run:

1. Looks up the most recent `"promote"` entry for that env in
   `deployments/log.json` (or a specific one via `--to <ISO-timestamp>`,
   see `scripts/rollback-snapshot.ts`'s usage string).
2. Runs `wrangler d1 time-travel restore` to that entry's `preBookmark`.
3. Re-runs the shared smoke checks (`scripts/smoke-checks.ts`) and writes
   evidence to `evidence/rollback-<env>-<timestamp>.json`.
4. Appends its own `"rollback"` entry to `deployments/log.json`.

D1 Time Travel bookmarks are retained for 30 days on all plans — a
promotion older than that can no longer be rolled back this way; re-promote
a known-good snapshot artifact from `fixtures/` instead.

This does **not** touch the deployed Worker code — only D1 content.

## 3. Both at once

If a release shipped bad code *and* a bad snapshot together, roll back data
first (so the currently-live code isn't reading a half-migrated database),
then roll back code:

```bash
npm run db:rollback:production
npx wrangler rollback <last-known-good-version-id> --env production -m "..."
npm run smoke:live -- --url https://theallodium.org
```

## 4. Verify after any rollback

Always finish with the live HTTP-level smoke suite, since it's the only
check that exercises the actual deployed Worker + D1 pair together:

```bash
npm run smoke:live -- --url https://theallodium.org
```

## OpenGraph cards (R2) — not covered by rollback

Phase 2E's per-entry OG card PNGs in the `OG_CARDS` R2 bucket are
content-addressed by `{snapshot checksum}/{entry id}.png` and are
best-effort, explicitly **not** covered by D1 Time Travel or any rollback
step above — rolling back D1 to a prior checksum does not restore that
checksum's R2 objects if `upload-og-cards.ts` has since pruned them (it
keeps only the most recently promoted generation's cards). The accepted
consequence is cosmetic only: `GET /og/:filename` redirects to
`public/og-default.png` whenever the current checksum's card is missing —
never a broken page or a 500. If a rolled-back checksum's cards still
happen to exist in R2 (e.g. the rollback follows immediately after the
promotion that superseded them, before the next `promote:og-cards` prune
runs), they resolve automatically since the route reads whatever checksum
is currently live in `snapshot_manifest`. Otherwise, re-run
`.venv/bin/python3 scripts/render_og_cards.py` (ACT) and
`npm run promote:og-cards -- --env <env> --checksum <checksum>` to restore
per-entry cards for the rolled-back generation.

## `.com` redirect

The `theallodium.com` → `theallodium.org` redirect (`scripts/configure-com-redirect.ts`)
is a zone-level Cloudflare Ruleset plus two placeholder proxied DNS records
(apex + `www`, needed since a zone with no DNS records has no hostname for
Cloudflare's edge to route to at all), entirely independent of the Worker
and D1 — it never needs rolling back as part of a code or data incident. If
it ever needs to change, re-run `npm run configure:com-redirect` — both the
DNS records and the ruleset PUT are idempotent.
