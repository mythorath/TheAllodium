# Publication Contract v1

Collection: `psychotherapy`
Contract version: `1.1` (see [Phase 2A addendum](#v11-addendum-phase-2a) below)
Schema version: `1`

This contract defines the public-safe D1 row shape for The Allodium.
Source evidence: `/tank/ACT/scripts/export_showcase.py` and
`/tank/ACT/scripts/act_lib/catalog.py`. The Worker never imports ACT Python.

## Allowed entry fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | text | Stable ACT 16-char hex ID |
| `title` | text | Required |
| `resource_type` | text | paper, handout, worksheet, … |
| `therapy_modality` | text | act, cbt, dbt, … |
| `source_org` | text \| null | |
| `canonical_url` | text | Outbound link only |
| `author` | text \| null | |
| `published_date` | text \| null | ISO-ish date string |
| `credibility_tier` | integer | 1–4 |
| `is_link_only` | integer 0/1 | |
| `citation_count` | integer \| null | |
| `oa_status` | text \| null | gold/green/hybrid/bronze/diamond/closed |
| `doi` | text \| null | Public identifier |
| `pmid` | text \| null | |
| `pmcid` | text \| null | |
| `link_status` | text | `ok` \| `blocked` \| `unchecked` |
| `link_checked_at` | text \| null | ISO timestamp |
| `updated_at` | text \| null | Source row update time |

Dead links are **excluded** from the public set. Blocked links remain
discoverable and must be labeled inconclusive.

## Tags

Normalized `tags(name, category)` + `entry_tags(entry_id, tag_id)`.
Categories mirror ACT: modality, topic, hexaflex, format, skill modules, etc.

## Verifications (normalized, no rationale)

| Field | Type | Notes |
|-------|------|-------|
| `entry_id` | text | FK |
| `check_kind` | text | `identity` \| `legitimacy` \| `link` |
| `result` | text | ok / mismatch / weak / keep / reject / needs_review / blocked / … |
| `method` | text | e.g. `crossref`, `openalex`, `qwen3.6:35b`, `http-check` |
| `method_version` | text \| null | |
| `score` | real \| null | similarity or confidence |
| `checked_at` | text \| null | Honest null if unknown |

Never store raw `notes`, LLM rationale strings, or remote title dumps.

## Aliases

`entry_aliases(alias_id, canonical_id)` — retired ACT IDs redirect to the
current canonical entry.

## Snapshot manifest

| Field | Notes |
|-------|-------|
| `contract_version` | `1` |
| `schema_version` | `1` |
| `collection` | `psychotherapy` |
| `source_generated_at` | ACT export time |
| `entry_count` | |
| `tag_link_count` | |
| `alias_count` | |
| `checksum` | SHA-256 of public payload |
| `abstract_search_enabled` | 0/1 feature gate |
| `exclusion_counts_json` | gated, dead, retracted, junk, duplicates |

## Search documents (isolated)

`entry_search_documents` holds only text approved for indexing:
- always: title, author, source_org, tags, modality, resource_type
- optional (feature-gated): abstract

Abstracts must never appear in HTML, JSON view models, snippets, logs,
JSON-LD, sitemaps, or `LIKE` fallback result payloads.

## Explicitly forbidden

- `notes`
- `file_path`
- `extracted_text_path`
- stored PDF / full text / transcripts
- ACBS member-only (`acbs-member-personal-use`) rows
- model rationale / prompt text
- local filesystem paths
- any field not on the allowlist above

## URL contract

- Canonical: `/psychotherapy/entries/{stable-id}`
- Alias: same path with a retired ID → `301` to canonical
- Search: `/psychotherapy/search?q=&page=`

## Import artifact (for later milestones)

D1 import uses versioned `.sql` files via `wrangler d1 execute --file`,
not a SQLite database file. A shareable SQLite dump is Phase 4.

## v1.1 addendum (Phase 2A)

Two new allowed entry fields, plus one new snapshot-content table:

| Field | Type | Notes |
|-------|------|-------|
| `audience` | text | `client` \| `clinician` \| `unknown` — derived at export time from `format`-category tags (`clinician_facing`/`group_protocol` → clinician, `client_facing`/`self_help` → client) falling back to `resource_type` when no format tag is present. `unknown` is a safety net, not an intended steady state. |
| `authors_json` | text \| null | Structured OpenAlex author list (name, ORCID, institution, position) for papers; `null` for everything else. The plain `author` display string is unchanged and still required. |

`entry_neighbors(entry_id, neighbor_id, rank, score)` — precomputed
cosine-kNN (top 10) over `backend/data/embeddings.npy`, rebuilt in full on
every snapshot import like every other content table. Not read by any route
until Phase 2C's related-entries UI. `snapshot_manifest.coverage_json` gains
`audience` and `neighbors` breakdowns so the exporter's embedding-freshness
gate (fails the export if more than 2% of public entries lack an embedding)
has a published, honest coverage number rather than a silent gap.
