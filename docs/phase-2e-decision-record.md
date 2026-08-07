# Phase 2E Decision Record

Generated: 2026-08-07T08:27:44.408Z

## What this phase proved

Every prior phase's social-preview surface was whatever a bare link unfurls
to — nothing. Phase 2E adds a real per-entry OpenGraph card pipeline: a
dark, sleek 1200x630 PNG rendered in ACT from public-contract fields only,
served content-addressed from R2 by the Worker, with a static default card
so a missing or not-yet-uploaded card is never a broken social preview.

## ACT: the card renderer

- `og_card.py` (new): pure `render_card(entry: dict) -> Image` and
  `render_default_card() -> Image`, built only from
  `title`/`therapy_modality`/`resource_type`/`credibility_tier` —
  never abstract/notes/rationale, matching the roadmap's "OG inputs come
  only from contract fields" rule. A shared dark slate/navy gradient
  template (with a soft blurred accent-blue glow, the logo mark matching
  `favicon.svg`, and a footer wordmark) is built once per process and
  cached, since it's identical across every card; each render blits a copy
  and adds the auto-shrinking title (up to 3 lines, ellipsis-truncated as a
  last resort) plus modality/resource-type/tier pill badges.
- `render_og_cards.py` (new): imports `build_snapshot()`/
  `compute_checksum()` directly from `export_allodium_snapshot.py` —
  zero drift between what a real snapshot export would produce and what
  gets rendered. Writes to `exports/allodium/og_cards/{checksum}/{id}.png`;
  a rerun at an unchanged checksum is a no-op per entry unless `--force`.
  `validate_og_cards()` mirrors `validate_snapshot()`'s preflight
  convention: every entry has a PNG, every PNG is a valid 1200x630 file,
  and the on-disk set matches the entry list exactly.
- Inter (OFL-licensed static Bold/SemiBold/Regular/ExtraBold weights)
  vendored under `assets/fonts/Inter/` with its license — no font existed
  in either repo before this phase, and system fonts aren't deterministic
  across render machines. Pillow added explicitly to `requirements.txt`
  (previously only informally present via other scripts' plain resize
  usage; this phase adds the repo's first `ImageDraw`/`ImageFont` use).
- The static default card is rendered once via the same template function
  and committed as TheAllodium's `public/og-default.png` — a real static
  asset, not something the Worker generates at request time.

## TheAllodium: R2 binding and serving route

- `wrangler.jsonc` gets an `OG_CARDS` R2 binding (local/staging/
  production bucket names), mirroring the existing per-env `d1_databases`
  pattern. Vitest's workers pool reads bindings straight from this file, so
  R2 is simulated locally in tests automatically once the binding exists —
  confirmed against real fixture-backed tests in `tests/og-cards.test.ts`,
  no separate mock needed.
- `GET /og/:filename` (new route in `src/index.tsx`): splits `.png` off
  the filename rather than relying on Hono's dot-in-param regex syntax
  (avoiding a version-fragile pattern), resolves the id through the
  existing `resolveCanonicalId()` (so an alias id gets its canonical
  entry's card, consistent with the entry route's own redirect behavior),
  reads the current checksum via `getManifest()`, and looks up
  `{checksum}/{canonical id}.png` in R2. Every failure mode — malformed
  filename, unknown/retired id, no current manifest, a missing R2 object,
  or any thrown error (wrapped in try/catch) — redirects to
  `/og-default.png` rather than ever 500ing on a social-preview fetch; a
  D1 Time-Travel rollback to a checksum whose cards were already pruned
  degrades the exact same way. The immutable `Cache-Control` on a hit is
  safe because the key itself already encodes the exact checksum.

## TheAllodium: OG/Twitter meta tags

`Layout` gained `ogImage`/`ogDescription`/`ogType` props (defaulting to
the static default card and `"website"`), rendering `og:title`,
`og:type`, `og:url`, `og:image`, `og:description`,
`twitter:card=summary_large_image`, `twitter:title`, and
`twitter:image` — only on pages that already have a single
`canonicalPath` (404/error pages correctly have neither canonical link nor
OG tags, an existing rule this phase extends rather than special-cases).
`EntryPage` passes `ogType="article"`, `ogImage` pointing at
`/og/{id}.png`, and an `ogDescription` synthesized only from
`resource_type`/`therapy_modality`/`source_org` — never
abstract/notes/rationale. `HomePage`, `SearchPage`, `StandardPage`, and
`DisclaimerPage` inherit the default card image plus a short hand-written
`ogDescription` each.

## Upload script and promotion runbook

- `scripts/upload-og-cards.ts` (new): concurrent R2 REST `PUT`s (a plain
  `wrangler r2 object put` per file would be far too slow at ~5,643
  files, each spawning a new CLI process) through a small hand-rolled
  bounded worker-pool — no new dependency, matching this project's existing
  style. Cross-checks `--checksum` against the target environment's live
  `snapshot_manifest.checksum` before uploading anything, so a stale or
  mistyped checksum can never silently upload cards for the wrong snapshot
  generation. Determines what to skip via one upfront paginated listing of
  the checksum prefix rather than a HEAD request per file — a first, naive
  per-file-HEAD version doubled the request count against the real R2 REST
  API and reproducibly tripped its rate limit (429s, then a longer-lived
  general abuse-prevention throttle) partway through the real ~5,643-file
  production upload; fixed with the bulk listing plus low concurrency, a
  fixed inter-request pacing delay, and exponential-backoff retries on any
  remaining transient failure. After a fully successful upload, deletes any
  *other* checksum prefix already in the bucket (list + bulk delete) so
  storage doesn't grow unbounded across promotions — the new generation is
  always uploaded and confirmed before the old one is removed. New
  `"og-card-upload"` entry type in `deployments-log.ts`, logging
  `{ checksum, cardCount, prunedChecksum }`.
- `docs/rollback-runbook.md` gets an explicit new section: R2 cards are
  best-effort and **not** covered by D1 Time Travel or any rollback step —
  an accepted limitation, since a stale/missing card only ever falls back
  to the default image, never breaks a page.

## Tests

- `tests/og-cards.test.ts` (new): a fixture PNG `put()` directly into the
  simulated `OG_CARDS` bucket, then asserts the route's hit path (200,
  `image/png`, immutable cache header, exact byte match), alias
  resolution, an unknown id, a known id whose card was never uploaded
  (standing in for a pruned/rolled-back checksum), and a malformed filename
  — every non-hit case redirecting to `/og-default.png`. A second
  `describe` block asserts og/twitter tag presence and correct absolute
  URLs on an entry page (including the contract-safe synthesized
  description) and confirms every other canonical page falls back to the
  default card image; a third case confirms pages with no canonical URL
  (404) carry no OG/Twitter tags at all.
- `e2e/routes.spec.ts` (3 new tests): confirms `og:image`/`twitter:image`
  on home, an entry page, and search all resolve to a real, reachable
  `image/png` response through the live dev Worker (following the
  route's own redirect-to-default fallback, since no card has been
  uploaded to the local/test R2 bucket) — no new a11y suite needed for a
  binary image endpoint.
- `scripts/smoke-og-cards.ts` (new, same style as `smoke-live.ts`):
  real HTTP-level checks against a deployed Worker — `/og-default.png`
  plus a few real entry ids discovered from `/sitemap.xml`, each asserted
  to return HTTP 200, `Content-Type: image/png`, a valid PNG signature,
  and exactly 1200x630 dimensions (parsed directly from the IHDR chunk, no
  new dependency). Writes `evidence/smoke-og-cards-<timestamp>.json`,
  following the same evidence-file convention as `smoke-live.ts`. Never
  run automatically by any gate — run manually against staging/production
  after a real deploy plus `npm run promote:og-cards`, exactly like
  `smoke:live` today.

## Exit gate

- `npm run typecheck` and `npm test` (Vitest, Workers runtime) pass.
- `npm run test:e2e` (Playwright + axe-core) passes, including the new
  OpenGraph cards suite.
- Live OG card smoke evidence exists for `https://theallodium.org` with every check
  passing (found at 2026-08-07T08:26:08.789Z), proving a real deployed R2 bucket
  serving real, correctly-shaped card images — this phase's roadmap exit
  criterion explicitly requires that, unlike 2B-2D's code-only gates.

## Explicitly out of scope this phase

- No contract/schema version bump — cards are derived from existing public
  fields, never stored in D1.
- No OG card for the shortlist page (`/psychotherapy/list`) — the roadmap
  only names entries, search, and the landing page.
- No CDN/CSP change — `/og/*` stays same-origin under the unchanged
  `default-src 'self'; img-src 'self'` policy.

## Stop

Phase 2E ends here. Do not start the next phase until this record is
accepted.
