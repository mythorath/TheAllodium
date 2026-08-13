# Phase 2.5B Decision Record

Generated: 2026-08-12T23:31:49.898Z

## What this phase proved

Phase 2.5A made the catalog honest about papers vs. materials. The
dimensions that actually discriminate *within* each side — topic tags,
hexaflex processes, resource type, and publication decade — were already
in D1 and already in FTS meta, but they were not filterable and tags on
the entry page were not links. Phase 2.5B turns those unused columns into
facets and makes topic/hexaflex tags a way to start a search.

No migration, no contract version bump, no ACT exporter change.
`entry_tags` / `tags`, `resource_type`, and `published_date` were
already indexed. `CONTRACT_VERSION` stays `"1.2"`. The `e.id ASC`
sort tiebreaker from the link-integrity work is unchanged.

## Four new repeatable facets

`FacetFilters` gained `topic`, `hexaflex`, `type`, and `decade`.
OR within a dimension, AND across dimensions, cap 25 — same rules as
modality/audience.

- `topic` / `hexaflex` use `EXISTS (entry_tags JOIN tags …)` filtered
  by `t.category`. Names are data-driven (no hardcoded allowlist).
- `type` is `e.resource_type IN (…)`, data-driven like modality.
- `decade` is an allowlisted `published_date` string range
  (`2020s` / `2010s` / `2000s` / `pre-2000`), not a new column.

SQL always honors these params. The UI is conditional: **Type** only when
`kind=materials`, **Decade** only when `kind=literature`, **Topic** and
**Hexaflex** for both kinds (including All). Deep-links still filter when
the group is hidden.

## `kind` stays the corpus selector

"Clear filters" drops topic/hexaflex/type/decade (and the existing five
checkbox dimensions) and **keeps** `kind`, `q`, and `sort`. A
topic-only URL is enough to enter browse; the empty landing (no q, no
kind, no facets) is unchanged.

## Clickable tags

On the entry page, `category === "topic"` and `"hexaflex"` become
links to `/psychotherapy/search?topic=…` or `?hexaflex=…` — a fresh
search, preserving nothing (not even `kind`). Other categories
(modality, format, skill modules) stay plain text. No generic `?tag=`
param.

## Tests

- `tests/repository.test.ts`: parse/WHERE for the four new dimensions,
  topic/hexaflex/type/decade browse on the 12-row fixture, empty landing
  still empty, entry HTML links topic/hexaflex tags and does not link
  modality tags.
- `tests/full-snapshot.test.ts`: literature decade hits fall in the
  bucket range; materials type options contain no `paper`; topic/hexaflex
  values stay inside the known ontology.
- `tests/link-integrity.test.ts`: pagination walk for
  `topic=depression` + `title_asc` (tag-JOIN WHERE shape).
- `e2e/routes.spec.ts`: Topic/Hexaflex on the empty landing, Type vs
  Decade gated on kind, tag click → filtered search, Clear-filters keeps
  kind and drops topic, no-JS tag href.

## Exit gate

- `npm run secrets:scan`, `typecheck`, `test` (Vitest, Workers runtime)
  pass.
- `npm run test:e2e` (Playwright + axe-core) passes, including the new
  facet/tag suite, with zero serious/critical accessibility violations.
- Neither staging nor production was touched this phase. Live
  `audit:links` remains a post-deploy action.

## Explicitly deferred to 2.5C+

- Directory landings (`/psychotherapy/topics`, `/psychotherapy/hexaflex`),
  home directory strip, nav/sitemap — 2.5C.
- Facet auto-submit, compact pagination, `?like={id}` — 2.5D.
- Within-modality process tags (CBT skill, DBT module, …) as global facets.
- `source_org` facet, author browse, abstract FTS, LLM.
- Deploying the updated Worker code to staging/production — a separate,
  deliberate action outside any phase gate.

## Stop

Phase 2.5B ends here. Do not start 2.5C until this record is accepted.
