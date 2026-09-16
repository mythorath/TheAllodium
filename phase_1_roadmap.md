---
name: Phase 1 roadmap
overview: Turn the original Foundation phase into six separately plannable milestones, beginning with the risky data/search contract and ending in a staged public beta. The roadmap preserves later facets, citations, neighbors, dataset dumps, MCP, and additional collections without pulling those features into Phase 1.
todos:
  - id: plan-1a
    content: Plan and execute the publication-contract and Cloudflare/D1 risk spike
    status: completed
  - id: plan-1b
    content: Plan structured ACT provenance, rights states, aliases, and versioned snapshot export
    status: completed
  - id: plan-1c
    content: Plan the thin staging vertical slice using representative records
    status: completed
  - id: plan-1d
    content: Plan the deterministic full-snapshot promotion and rollback pipeline
    status: completed
  - id: plan-1e
    content: Plan the public-beta search, entry, and methodology experience
    status: completed
  - id: plan-1f
    content: Plan discoverability, domain, operations, and launch-readiness work
    status: completed
isProject: false
---

# The Allodium Phase 1 Roadmap

## Decisions now locked
- Hono + TypeScript, server-rendered on Cloudflare Workers; no React hydration requirement.
- New Worker code lives in [`/tank/TheAllodium`](/tank/TheAllodium); [`/tank/ACT`](/tank/ACT) remains the source system and emits a versioned public artifact.
- Build a thin end-to-end staging slice first, then expand and harden it.
- Permanent URLs use `/psychotherapy/entries/{stable-id}`. Existing ACT IDs remain canonical; merged IDs become redirects through an alias mapping.
- Collection one is the full 5,643-entry psychotherapy export across all 21 modalities, not the ACT-only subset.
- Raw `notes`, local paths, stored files, and model rationale never enter the public artifact. Public provenance comes from structured ACT verification records.
- Abstracts may be indexed but are not displayed, returned as snippets, or included in public dumps. Production abstract indexing remains gated on a rights review; metadata-only FTS is the safe launch fallback.
- DOI, PMID, PMCID, and canonical-source identifiers are eligible public metadata and belong in the contract now for JSON-LD and later citation export.
- A blocked link remains discoverable but is labeled as inconclusive; only confirmed-dead links are excluded.
- Snapshot publication is manual and staged: generate on Selis, validate against staging, then explicitly promote.

## Required roadmap correction
`wrangler d1 execute --file` ingests a `.sql` file, not a SQLite database file. Phase 1 should produce a versioned SQL import artifact plus a manifest/checksum. A shareable SQLite export remains a later Phase 4 dataset product, not the D1 deployment input.

## 1A: Contract and Cloudflare risk spike
- Specify the versioned public-entry, tag, verification, alias, and snapshot-manifest contracts using evidence from [`scripts/act_lib/catalog.py`](/tank/ACT/scripts/act_lib/catalog.py) and [`scripts/export_showcase.py`](/tank/ACT/scripts/export_showcase.py).
- Prototype Hono JSX SSR, typed D1 bindings, Static Assets, one entry route, and one search route against a tiny fixture.
- Prove on local and remote staging D1: FTS5 creation/rebuild, metadata-only `LIKE` fallback, SQL-file import, query ranking, and behavior while replacing a snapshot.
- Exit gate: select the exact FTS schema, fallback semantics, import transaction/swap approach, and measurable latency/relevance acceptance targets. Do not design the full Worker until this spike passes.

## 1B: Durable publication data in ACT
- Replace provenance parsing as the source of truth with structured verification records populated by the identity, legitimacy, and link-check workflows in [`scripts/verify_identity.py`](/tank/ACT/scripts/verify_identity.py), [`scripts/verify_legitimacy.py`](/tank/ACT/scripts/verify_legitimacy.py), and [`scripts/verify_corpus.py`](/tank/ACT/scripts/verify_corpus.py).
- Backfill normalized result, method/version, score or confidence, and checked-at values where evidence exists; represent unknown timestamps honestly rather than deriving them from unrelated `updated_at` values.
- Persist dedupe aliases so previously published IDs can redirect after canonical merges.
- Add focused tests for the public-safe filter, structured provenance backfill/export, alias preservation, and forbidden-field denial; these are not covered by the existing ACT tests.
- Define field-level rights states for future entry expansion. Keep abstracts non-displayable and make production indexing feature-gated.
- Exit gate: a tested, versioned public snapshot contains only approved fields and reproduces the confirmed 5,643-row public-safe inclusion count and documented exclusions.

*Status note: 1B shipped bundled into the repository's initial commit (`75b9e9c`, "Phase 1A scaffold + Phase 1B publication contract"), before the per-phase `close-*-gate.ts`/decision-record convention started with 1A. There is no standalone `close-1b-gate.ts` or `docs/phase-1b-decision-record.md` for this reason. Its actual deliverable is [`docs/publication-contract-v1.md`](/tank/TheAllodium/docs/publication-contract-v1.md) (structured verification fields, alias table, forbidden-fields rights policy), backed by ACT's pre-existing `verify_identity.py`/`verify_legitimacy.py`/`verify_corpus.py` and the `entry_verifications`/`entry_aliases` tables that every later phase's tests exercise against real data. Functionally complete and proven; just never received its own formal gate run.*

## 1C: Thin vertical slice on staging
- Export a representative fixture spanning papers, client resources, blocked links, missing bibliographic fields, tags, and aliases.
- Import it into staging D1 and serve the canonical entry URL, alias redirect, basic keyword results, and `LIKE` fallback through Hono.
- Render normalized provenance without exposing raw notes or implying that automated legitimacy checks are clinical endorsement.
- Exit gate: one command creates the artifact, one documented operation loads staging, and route/search integration tests pass in a Workers-compatible test environment.

## 1D: Full snapshot and promotion pipeline
- Generate the full psychotherapy snapshot as deterministic SQL plus manifest, schema version, source timestamp, row counts, checksums, and exclusion counts.
- Add preflight checks for public-field allowlisting, referential integrity, duplicate IDs/URLs, aliases, FTS parity, and forbidden values such as local paths or gated licenses.
- Store `/standard/` coverage metrics in the same immutable snapshot so published numbers always describe the deployed rows rather than a newer ACT database.
- Define staging validation, explicit production promotion, rollback to the prior snapshot, and failure behavior that leaves the current production database intact.
- Exit gate: the complete catalog can be rebuilt and promoted without hand-editing SQL, with an auditable deployment record and tested rollback.

## 1E: Public beta experience
- Build the static shell, landing page, basic keyword search, result pagination, entry pages, and `/standard/`. Faceted search, collections, citations, neighbors, and GPU behavior remain in later phases.
- Make `/standard/` explain deterministic gates, DOI identity checks, legitimacy triage, health gates, limitations, update cadence, and live snapshot coverage numbers.
- Establish accessibility, responsive layout, no-cookie/no-account behavior, error/empty states, and clear crisis/disclaimer routing before visual polish.
- Exit gate: representative users can find, assess, and follow an outbound resource with Selis offline, and accessibility/route/search smoke tests pass.

## 1F: Discoverability and launch readiness
- Add field-appropriate JSON-LD, snapshot-generated sitemap files, `robots.txt`, and `llms.txt`; never emit hidden abstracts or internal provenance details through these surfaces.
- Configure canonical URLs, `.com` redirect, caching and security headers, production D1 bindings, deployment secrets, lightweight operational logs, and a rollback runbook.
- Validate broken-link presentation, 404/alias behavior, sitemap completeness, structured data, search fallback, and production smoke tests.
- Exit gate: public beta is deployable, observable, reversible, and independent of Selis except when publishing a new snapshot.

## Later-phase compatibility rules
- Keep tags and entry fields typed so Phase 2 facets and citation export do not require reparsing display strings.
- Keep query logic behind a reusable repository/service boundary so Phase 4 MCP routes use the same filters and public-field policy.
- Include collection identity and schema version in every snapshot, while avoiding premature multi-collection UI or bindings.
- Reserve neighbor and citation-related tables as later migrations; do not add empty Phase 2 features to the Phase 1 interface.

Each milestone should receive its own implementation plan only after the preceding exit gate resolves its remaining evidence-based decisions.