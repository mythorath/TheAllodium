# Phase 4A Decision Record

Generated: 2026-09-02T04:45:00.000Z

## What this phase proved

The Allodium's public surface is a multi-collection house, not a
psychotherapy site with a collections heading. `/` is a welcome page
backed by a code registry of collections; psychotherapy lives at
`/psychotherapy`; site-wide chrome no longer pretends every page is
clinical. Physics and cosmology appear as dimmed, non-interactive
"In progress" cards so adding a real collection is a registry change,
not a homepage rewrite.

No migration, no contract version bump, no ACT exporter change.
`CONTRACT_VERSION` stays `"1.2"`. CSP is unchanged.

## Registry

[`src/collections.ts`](../src/collections.ts) is the single source of
truth: slug, label, lede, `live` | `planned` status, icon, collection
nav, optional shortlist href, optional `advisoryPath`.
`collectionForPath()` maps `/psychotherapy` and everything under it onto
the live psychotherapy collection, and returns null for `/`, `/standard`,
and planned slugs that have no routes yet.

## Collection-scoped chrome

`Layout` takes an optional `collection`. Psychotherapy pages pass
`PSYCHOTHERAPY`; `/`, `/standard`, 404, and 500 pass nothing.

- Header: the collection chip, Search/Topics/Hexaflex, and Shortlist
  render only when `collection` is set. The brand and The Standard stay
  site-wide.
- Footer: The Standard stays site-wide. The disclaimer link and 988
  advisory render only when `collection.advisoryPath` is set.

Crisis routing is unchanged: `?ask=` still short-circuits via
`isCrisisIntent` on `/psychotherapy/search` and still shows
`CrisisResources`. The site home has no search box and no mental-health
content, so the advisory is not duplicated there.

`public/app.js` is unchanged. `#shortlist-nav-link` is absent on
site-wide pages, and `renderShortlistNav` already no-ops in that case.

## `/standard` split

`/standard` stays at its URL and keeps the methodology (identity check,
legitimacy triage, link health), limitations, optional AI-assisted
search, and update cadence. Coverage tables and the exclusion list moved
to `/psychotherapy`, because they describe that collection's snapshot.
`/standard` points at the psychotherapy landing for live numbers.

## Disclaimer 301

`/psychotherapy/disclaimer` is the canonical clinical disclaimer.
`/disclaimer` 301s there so existing links, `llms.txt` readers, and
printed URLs keep working. Sitemap and OpenGraph canonicals use the new
path only.

## Tests

- `tests/repository.test.ts`: site home copy and planned-card markup,
  `/psychotherapy` doors + coverage + chrome, `collectionForPath`,
  `/standard` without snapshot tables, 301 from `/disclaimer`,
  canonical/sitemap/Set-Cookie updates.
- `tests/full-snapshot.test.ts`: door counts retargeted at
  `/psychotherapy`.
- `tests/og-cards.test.ts`: default card on `/psychotherapy` and
  `/psychotherapy/disclaimer`.
- `e2e/routes.spec.ts`: site home vs psychotherapy landing, planned
  cards expose no link role, disclaimer footer starts from a
  psychotherapy page, `/disclaimer` follows to the new path.
- `scripts/smoke-live.ts`: `/psychotherapy`, 988 on the new disclaimer
  path, `/disclaimer` 301.

## Exit gate

- `npm run typecheck`, `test`, and `test:e2e` pass.
- Neither staging nor production is deployed by this phase.

## Explicitly deferred

- A second live collection (physics, cosmology, or anything else)
- Per-collection D1 bindings and the Phase 5 collection-two playbook
- Collection-specific Standard/disclaimer pages beyond psychotherapy
- Changing `SITE_URL` / the `.com` → `.org` redirect
