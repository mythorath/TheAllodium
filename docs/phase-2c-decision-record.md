# Phase 2C Decision Record

Generated: 2026-08-07T05:10:07.496Z

## What this phase proved

Phase 2A populated `entry_neighbors` and `authors_json` but deferred
reading either. Phase 2C closes that loop on the entry page: a
related-entries block sourced from `entry_neighbors`, and BibTeX/RIS/APA
citation export with copy-to-clipboard, the site's first client-side JS,
added as progressive enhancement with no CSP change and a no-JS fallback
that is the same server-rendered content, not a degraded substitute.

No migration, no contract version bump, no ACT exporter change, every
field these two features read (`entry_neighbors`, `authors_json`,
`author`, `doi`, `published_date`, `source_org`, `canonical_url`) was
already public contract v1.1 as of Phase 2A.

## Related entries: `getRelatedEntries()`

A single `entry_neighbors JOIN entries ORDER BY rank` in
`src/db/repository.ts`, returning a new `RelatedEntry` contract type
(`id`, `title`, `therapy_modality`, `link_status`: the roadmap's exact
field list, not the internal `rank`/`score` ranking signal). The plain
INNER JOIN is what makes "honest empty state when coverage is missing"
free: an entry with no embedding at snapshot-build time simply has zero
`entry_neighbors` rows, so the function returns `[]` with no special
casing, and `EntryPage` renders "No related entries in this snapshot",
the same honest-empty-state convention already used for tags and
verifications.

## Citation formatting: `src/citations.ts`

A pure module (no D1, no I/O) with `buildBibtex`/`buildRis`/`buildApa`,
each taking only a `PublicEntry`. Design choices, and their limitations,
documented in the module itself and summarized here:

- **BibTeX key = the entry's own id** (`allodium:{id}`), not a
  name/year-derived key, avoids collisions and edge cases (empty authors,
  non-Latin names) that fragile key generation would hit.
- **`@article` vs `@misc`**: papers get `@article` with `journal` =
  `source_org`; everything else gets `@misc` with `organization` =
  `source_org`. The contract has no real journal/volume/issue/page fields,
  so this is the best publicly available approximation, not a claim of
  full bibliographic precision.
- **Structured vs. plain authors are handled differently, deliberately.**
  `authors_json` names go through a best-effort `splitName()` heuristic
  (last whitespace token = family name) for RIS `AU` lines and APA
  initials. The plain `author` display string, used only when
  `authors_json` is absent. Is treated as one opaque unit and never
  re-split, since its internal structure isn't guaranteed (could already
  be given-family order, multiple names joined some other way, or an
  organization name). An earlier draft of `citations.ts` ran the same
  split heuristic over both sources uniformly; caught and fixed before
  merge by `tests/citations.test.ts`'s plain-author-fallback case, which
  asserted the raw string should survive unmodified into the APA string.
- **DOI as a doi.org link**: `citationUrl()` returns
  `https://doi.org/{doi}` when a DOI exists, else `canonical_url`: used
  as the `url`/`UR` field in BibTeX/RIS (inert plain text, since real
  bibliography files must not contain HTML) and rendered as a real
  `<a href>` in the human-facing APA paragraph.
- **BibTeX escaping**: `escapeBibtex()` handles `& % $ # _ { } ~ ^` so a
  title containing any of them still round-trips through a real BibTeX
  parser without breaking the entry.

## Entry page and the first client-side JS

- `Layout` gained an optional `bodyExtra` slot rendered just before
  `</body>`, so a page-scoped `<script src>` only loads where it's
  actually used. `EntryPage` is the only page that references `app.js`
  today.
- `public/app.js`: one delegated click listener
  (`document.addEventListener("click", …)` + `Element.closest`) copying
  the `textContent` of whatever `<pre>`/`<p>` a `data-copy-target`
  button points at, via `navigator.clipboard.writeText`. No embedded
  JSON payload, the already-rendered citation text *is* the copy source,
  which is also exactly the no-JS fallback content, so there's no separate
  code path to keep in sync.
- The CSP (`default-src 'self'`) is untouched: an external same-origin
  `<script src="/app.js">` was already permitted. Copy buttons stay
  visible with JS disabled (inert, no crash) rather than being hidden via
  a `<noscript><style>` block. That pattern would itself violate the
  current `style-src 'self'` (no `unsafe-inline`), and the roadmap
  requires "CSP unchanged."
- Named `app.js`, not `copy-citation.js`: Phase 2D's roadmap text
  explicitly reuses "the same static JS file" for add-to-shortlist, so the
  generic name avoids a rename later.

## Test coverage added

- `tests/citations.test.ts` (11 tests, no D1 needed: pure functions):
  validates generated BibTeX against `@retorquere/bibtex-parser` (the
  engine behind Better BibTeX for Zotero) and generated RIS against
  `@customcommander/ris`, both added as **devDependencies** only,
  satisfying the roadmap's "citations validate against reference
  BibTeX/RIS parsers" gate criterion with real third-party parsers, not
  round-tripping through our own formatting logic. Covers a paper with
  structured `authors_json` + DOI, a client resource with only a plain
  `author` string and no DOI, a no-author/no-date entry (APA's "n.d." and
  title-leads-when-no-author paths), and a LaTeX-special-character
  escaping round trip. APA has no formal parser to validate against, so
  its tests assert exact expected output instead.
- `tests/repository.test.ts`: `getRelatedEntries()` returns rank-ordered
  neighbors for an id with rows and an empty array for one without, plus
  full-page HTML assertions that both sections render (related entries,
  all three citation formats, the doi.org link, the `app.js` script tag)
  and that the empty-related-entries state renders honestly.
- `tests/full-snapshot.test.ts`: `getRelatedEntries()` against the most-
  connected real entry matches a raw SQL query, byte-for-byte, over the
  actual 5,643-row corpus.
- `e2e/routes.spec.ts` (4 new tests): related entries + empty state,
  citation content + doi.org link, a real clipboard copy (permissions
  granted via Playwright's `context.grantPermissions`) with "Copied!"
  feedback, and a `javaScriptEnabled: false`-scoped test proving the
  citation text stays fully visible and the page never errors with JS
  off, each with a zero-serious-violation axe scan.

## Staging and production: untouched this phase

No migration, no snapshot/manifest change, there is nothing new to
promote or verify on staging, so (following 1E's precedent) this gate is
test/e2e-only. Deploying the updated Worker code to staging/production so
the live site actually serves the new sections stays a separate,
deliberate action outside any phase gate, same as every prior phase.

## Exit gate

- `npm run typecheck` and `npm test` (Vitest, Workers runtime, 90+
  tests) pass.
- `npm run test:e2e` (Playwright + axe-core, 20+ tests) passes, including
  the new citations/related-entries suite, with zero serious/critical
  accessibility violations.
- Neither staging nor production was touched this phase.

## Explicitly deferred to 2D+

- Shareable shortlists (`/psychotherapy/list?ids=…`), add-to-shortlist as
  a second feature in `app.js`, whole-shortlist citation export, and
  print stylesheets: Phase 2D.
- Deploying the updated Worker code to staging/production: a separate,
  deliberate action outside any phase gate.
- OpenGraph cards over R2, and every later Phase 2 subphase per the
  roadmap.

## Stop

Phase 2C ends here. Do not start 2D until this record is accepted.
