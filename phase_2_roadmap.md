---
name: Phase 2 roadmap
overview: Break the Make-it-genuinely-useful phase into five separately plannable milestones, snapshot data foundation (contract v1.1), faceted browse/search, related entries plus citation export, shortlists with print support, and the OG-card pipeline, all surviving Selis being offline, reusing Phase 1's snapshot/promotion/gate machinery unchanged.
todos:
  - id: plan-2a
    content: "Plan and execute contract v1.1: audience derivation, authors_json, entry_neighbors, embedding-freshness preflight"
    status: completed
  - id: plan-2b
    content: Plan faceted browse and search with uncapped, URL-stated filters over FTS5 and LIKE
    status: completed
  - id: plan-2c
    content: Plan related-entries block and client-side BibTeX/RIS/APA citation export
    status: completed
  - id: plan-2d
    content: Plan URL-encoded shareable shortlists, no accounts, plus the print stylesheet
    status: completed
  - id: plan-2e
    content: Plan the Selis-rendered OG card pipeline through R2 and Worker meta tags
    status: completed
isProject: false
---

# The Allodium Phase 2 Roadmap

## What Phase 2 inherits from Phase 1

Phase 1 shipped more than the original roadmap asked for, and Phase 2 should reuse it rather than rebuild:

- A versioned snapshot pipeline: [`scripts/export_allodium_snapshot.py`](/tank/ACT/scripts/export_allodium_snapshot.py) in ACT emits deterministic `import.sql` + manifest + checksum; [`scripts/promote-snapshot.ts`](/tank/TheAllodium/scripts/promote-snapshot.ts) promotes through staging to production with Time-Travel rollback and an auditable `deployments/log.json`.
- A typed publication contract ([`src/contract.ts`](/tank/TheAllodium/src/contract.ts), mirrored in the exporter) with allowlist/denylist tests on both sides.
- A repository boundary ([`src/db/repository.ts`](/tank/TheAllodium/src/db/repository.ts)) with FTS5 + `LIKE` fallback, which Phase 4 MCP routes will also consume: all Phase 2 query logic goes here, not in routes.
- Gate scripts, Workers-runtime vitest, Playwright + axe e2e, and live smoke checks, each Phase 2 milestone gets the same treatment.

## Facts confirmed against the data

- All 5,643 deployed snapshot entries have embeddings: `backend/data/embeddings.npy` is (5643, 768) float32 from `embeddinggemma:300m`, and every id in `resource_ids.json` appears in `fixtures/full_snapshot.sql`. Precomputed neighbors launch with 100% coverage.
- The audience facet cannot come from tags alone: `format`-category tags cover ~692 of 6,708 resources. **Decision (user-confirmed): derive an `audience` field at export time**, format tags where present, else mapped from `resource_type` (paper/protocol/evidence_summary/book_chapter → clinician; handout/worksheet/audio/video/article/ebook/assessment → client), with the rule documented on `/standard/`.
- `oa_status` lives on the `papers` table (gold 2,195, green 925, hybrid 911, bronze 610, diamond 432, closed 150, null 1,022) and is already an allowed entry field: the free-vs-paywalled facet needs no new source data, only honest handling of nulls (non-paper entries).
- `entries.author` is a single display string ("Russ Harris"); `papers.authors_json` holds structured OpenAlex author lists (names, ORCIDs, institutions). Real BibTeX/RIS/APA export wants the structured list, which is public bibliographic metadata: a contract v1.1 addition, not a rights problem.
- There are currently no OG/twitter meta tags in [`src/views/pages.tsx`](/tank/TheAllodium/src/views/pages.tsx), no R2 binding in [`wrangler.jsonc`](/tank/TheAllodium/wrangler.jsonc), and no client-side JavaScript anywhere. CSP is `default-src 'self'`, so self-hosted script files work but inline scripts stay forbidden.

## 2A: Contract v1.1 and snapshot data foundation

Everything later in the phase reads fields this milestone creates, so it goes first and alone.

- Extend the contract to v1.1 on both sides ([`src/contract.ts`](/tank/TheAllodium/src/contract.ts) and the exporter): add `audience` (derived, with derivation provenance), `authors_json` (structured, papers only), and an `entry_neighbors` table (`entry_id`, `neighbor_id`, `rank`, `score`).
- New migrations (`0004_phase2.sql`) following the existing full-rebuild-on-import pattern; neighbors are snapshot content, replaced atomically by the same promotion transaction.
- Extend `export_allodium_snapshot.py`: compute the audience derivation, join `authors_json`, and run kNN (cosine, top ~10) over `embeddings.npy` at export time, emitting neighbor INSERTs into the same `import.sql`.
- Embedding-freshness gate in preflight: fail the export if snapshot entry ids and `resource_ids.json` diverge beyond a stated threshold, with the documented fix being a re-embed via [`backend/embed_corpus.py`](/tank/ACT/backend/embed_corpus.py). Record neighbor coverage in `coverage_json`.
- Preflight additions: audience values from a closed enum, neighbor referential integrity (both ids must be snapshot entries), `authors_json` parses and contains no forbidden substrings.
- Exit gate: a full snapshot regenerates deterministically with the new fields, passes preflight, reproduces the 5,643-row count, and promotes to staging with rollback still proven.

## 2B: Faceted browse and search

- Repository: a typed `FacetFilters` parameter (modality, audience, free-vs-paywalled from `oa_status`, stored-vs-link-only from `is_link_only`, link_status) composed with both FTS5 MATCH and the `LIKE` fallback; browse-with-no-query becomes a first-class path, not an error.
- Uncapped means every result reachable: keep pagination (raise `PAGE_SIZE` sensibly) but never truncate totals; facet value counts shown against the current filter set.
- Server-rendered facet UI on `/psychotherapy/search`: plain links and forms, filter state entirely in the URL (shareable, cacheable, no JS required).
- Exit gate: facet/keyword combinations pass Workers-runtime tests and the Playwright + axe suite; staging smoke extends to faceted queries; latency stays within the 1A acceptance targets.

## 2C: Entry page: related entries and citation export

- Related-entries block on `/psychotherapy/entries/{id}` from `entry_neighbors` (title, modality, link status), server-rendered, empty state honest when coverage is missing.
- Citation export (BibTeX, RIS, APA) with copy buttons: the phase's first client-side JS, as a small self-hosted static file (CSP unchanged, no inline scripts); citation data embedded per entry via non-executable JSON or data attributes; graceful no-JS fallback showing the formatted citation as selectable text.
- Uses `authors_json` when present, falling back to the `author` display string; DOI rendered as a `doi.org` link in citations.
- Exit gate: citations validate against reference BibTeX/RIS parsers in tests; e2e covers copy interactions and the no-JS fallback; axe stays green.

## 2D: Shareable shortlists and print

- A `/psychotherapy/list?ids=…` route rendering a server-side shortlist from D1. The URL is the entire shared state, no accounts, no cookies (preserving the 1F no-cookie smoke check).
- Add-to-shortlist as progressive enhancement in the same static JS file (localStorage for in-progress building, URL for sharing); cap list length and validate ids server-side.
- Whole-shortlist citation export (all three formats) on the list page.
- Print stylesheet covering entry pages and shortlists.
- Exit gate: a shortlist URL round-trips with JS disabled, unknown/alias ids degrade gracefully, print output verified in e2e.

## 2E: OpenGraph cards over R2

- A Selis-side renderer (Python, consistent with ACT's stack) producing one card PNG per entry from snapshot data, content-addressed by entry id + snapshot checksum.
- R2 bucket + upload script following the [`scripts/cloudflare-api.ts`](/tank/TheAllodium/scripts/cloudflare-api.ts) pattern; serving via an R2 binding on the existing Worker (`/og/{id}.png`) so no second public origin or CSP change is needed.
- OG/twitter meta tags in `pages.tsx` for entries, search, and the landing page; a static default card for non-entry pages and entries whose card is missing.
- Card upload joins the promotion runbook as a documented step; a missing card must never 500 an entry page.
- Exit gate: live smoke verifies `og:image` URLs return 200 with correct content type for sampled entries, and card-validator checks pass.

## Later-phase compatibility rules

- All filtering stays behind the repository boundary so Phase 4 MCP routes reuse `FacetFilters` and the public-field policy unchanged.
- Neighbor storage keys on entry ids, not embedding row order, so a future re-embed or model swap only regenerates rows.
- The client-side JS file stays a single small progressive-enhancement layer. Nothing in Phase 2 may require JS to read, search, or follow a resource, keeping the Phase 3 GPU layer additive.
- OG rendering inputs come only from contract fields, so cards can never leak what pages cannot.

Each milestone gets its own implementation plan only after the preceding exit gate closes, matching the Phase 1 working style.