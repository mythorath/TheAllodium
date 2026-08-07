# Phase 2D Decision Record

Generated: 2026-08-07T05:32:27.983Z

## What this phase proved

Phase 2C shipped the entry page's citation export as the site's first
client-side JS. Phase 2D reuses that same single file for a second
feature — shareable, URL-encoded shortlists — while keeping the roadmap's
constraints intact: no accounts, no cookies, no CSP change, and building a
list is JS-only but *reading* one never is.

No migration, no contract version bump, no ACT exporter change — a
shortlist is a batched read over entries the contract already exposes.

## The shortlist's entire state is one query param

`/psychotherapy/list?ids=aaaaaaaa00000001,bbbbbbbb00000003` — a single
comma-separated `ids` param, matching the roadmap's own `?ids=…` phrasing
and keeping the URL itself as the whole shareable artifact (no server-side
session, no database write on "add").

- `parseShortlistIds()` (`src/db/repository.ts`): pure string parsing —
  split on `,`, trim, drop empties, dedupe keeping first occurrence (list
  order is meaningful), cap at 50 ids (~850 chars at 16-char ids — safely
  under URL length limits).
- `getEntriesByIds()`: a handful of batched `IN (...)` queries regardless
  of list size, not a `getEntry()` loop — one query for direct entry hits,
  one for alias resolution against the misses (same `entry_aliases` table
  `resolveCanonicalId` already uses), then one batched `entries` query
  plus one batched `entry_tags`/`entry_verifications` query each, grouped
  by `entry_id` in JS. Requested ids that resolve to nothing land in
  `missingIds` for an honest "N of M items could not be shown" note rather
  than a 500 or a silently-shrunk list. Two requested ids that resolve to
  the same canonical entry (a canonical id and its own retired alias, both
  in one URL) collapse to a single row.
- No redirect-on-alias for this route, unlike `/psychotherapy/entries/:id`
  — a multi-id URL isn't meaningfully "canonicalized" the same way; aliases
  just resolve transparently in the render.

## Removing an item needs no JS at all

Each shortlist row's "Remove from this list" link is a plain,
server-rendered `<a href="/psychotherapy/list?ids=...">` recomputing the
current id list minus that one entry — no client-side state, no form
submission. Building a list (the "Add to shortlist" buttons on entry and
search/browse pages) is unavoidably JS-only, since there's no
account/session to persist to server-side, but *editing* a list you're
already viewing turns out to be free.

## Whole-shortlist citation export: `buildBibtexList` / `buildRisList`

Both new `src/citations.ts` exports are thin joins over the existing
per-entry `buildBibtex`/`buildRis` — a `.bib` file's entries and a
`.ris` file's records are already self-delimiting, so concatenation is
the entire implementation. Validated with the same reference parsers as
Phase 2C's single-entry tests (`@retorquere/bibtex-parser`,
`@customcommander/ris`), now asserting multi-entry/multi-record parsing
rather than re-checking our own string-joining logic.

APA has no analogous list-join: the shortlist page renders one `<p>` per
entry (via a shared `ApaCitationBody` helper factored out of Phase 2C's
`ApaCitation`) inside a single wrapping `#citation-apa`, so the existing
`data-copy-target`/`textContent` copy logic in `app.js` needed no changes
to cover every entry in the list.

## `app.js`: now loaded site-wide, plus shortlist state

- `Layout` now emits `<script src="/app.js" defer>` unconditionally
  instead of per-page via `bodyExtra` — every page benefits from at least
  one of copy-to-clipboard (entry pages), add-to-shortlist
  (entry/search/list pages), or the persistent shortlist nav link (every
  page). Still the roadmap's single small self-hosted file, same
  unchanged CSP.
- `allodium:shortlist` in `localStorage` holds a plain JSON array of
  entry ids. `data-shortlist-id` buttons toggle membership; a real
  `<a href="/psychotherapy/list" id="shortlist-nav-link">Shortlist</a>` in
  the nav (present without JS, a valid if empty destination) gets its
  `href`/text rewritten client-side once a saved list exists.
- All `localStorage` access is wrapped in `try`/`catch`: private-mode
  storage restrictions or a hand-corrupted value degrade to "treat as
  empty," never a thrown error.

## Print stylesheet

A single `@media print` block added to the existing `public/styles.css`
(no new file, no CSP impact) — no second stylesheet. Hides interactive-only
chrome (nav, footer, copy/shortlist buttons, remove-links, the skip-link)
that means nothing on paper; keeps citation blocks and result rows intact
with `break-inside: avoid` so they don't split awkwardly across a page
break. Covers both `EntryPage` and the new `ListPage`.

## Test coverage added

- `tests/repository.test.ts`: `parseShortlistIds()` dedupe/cap/trim/empty
  behavior; `getEntriesByIds()` against the fixture — canonical ids, a
  retired alias, an unknown id, request-order preservation, and the
  canonical-id-plus-its-own-alias dedupe case; full-page HTML assertions
  for `/psychotherapy/list` covering the empty prompt, a populated list
  with working remove-link hrefs and combined citation blocks, a
  partially-unresolvable list, and a fully-unresolvable one; plus checks
  that the "Add to shortlist" button and the persistent nav link render on
  entry, search, and every other page.
- `tests/full-snapshot.test.ts`: `getEntriesByIds()` against a real
  50-id, deliberately request-reversed sample from the full 5,643-row
  corpus — proving order comes from the request, not from SQL, and titles
  match individual lookups at the batch's start, middle, and end.
- `tests/citations.test.ts`: `buildBibtexList`/`buildRisList` validated
  against the same reference parsers as the single-entry case, including
  the empty-list and single-entry-matches-`buildBibtex`/`buildRis` edge
  cases.
- `e2e/routes.spec.ts` (8 new tests): add/remove toggling and the nav
  link's count on an entry page; accumulating a shortlist across a search
  result and an entry page into one shareable link; a shared shortlist URL
  rendering its entries with a working no-JS remove-link; the empty prompt
  and partially-unresolvable honest note; a real clipboard copy of the
  combined multi-entry BibTeX; print-media-emulated hiding of nav/footer/
  buttons; and a `javaScriptEnabled: false`-scoped test proving a shared
  shortlist link fully round-trips (entries, citations, and server-rendered
  removal) with JS off — each with a zero-serious-violation axe scan.

## Staging and production: untouched this phase

No migration, no snapshot/manifest change — nothing new to promote or
verify on staging, so (following 1E/2C precedent) this gate is
test/e2e-only. Deploying the updated Worker code stays a separate,
deliberate action outside any phase gate.

## Exit gate

- `npm run typecheck` and `npm test` (Vitest, Workers runtime, 100+
  tests) pass.
- `npm run test:e2e` (Playwright + axe-core, 25+ tests) passes, including
  the new shortlists/print suite, with zero serious/critical accessibility
  violations.
- Neither staging nor production was touched this phase.

## Explicitly deferred to 2E+

- OpenGraph cards over R2 and Worker meta tags — Phase 2E.
- Deploying the updated Worker code to staging/production — a separate,
  deliberate action outside any phase gate.
- Any "edit and reshare" workflow beyond the free server-rendered
  remove-links (e.g. client-side URL rewriting to add items to an
  already-shared list) — not asked for by the roadmap, and not added.

## Stop

Phase 2D ends here. Do not start 2E until this record is accepted.
