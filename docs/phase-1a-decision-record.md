# Phase 1A Decision Record

Generated: 2026-08-07T00:27:56.931Z

## Proven

- Hono + TypeScript JSX SSR Worker scaffold exists in `/tank/TheAllodium`.
- Publication contract v1 documented in `docs/publication-contract-v1.md` and enforced in `src/contract.ts`.
- Candidate D1 schema: entries, tags, entry_tags, entry_verifications, entry_aliases, snapshot_manifest, entry_search_documents, entry_fts.
- Local D1: migrate → fixture → FTS full rebuild works.
- Remote staging D1: migrate → fixture → FTS full rebuild works.
- Routes: `/psychotherapy/entries/:id` (canonical, alias 301, 404) and `/psychotherapy/search`.
- LIKE fallback searches title+meta only; abstracts never appear in HTML/results.
- Abstract indexing is feature-gated via `snapshot_manifest.abstract_search_enabled`.
- Secrets scan passed (credentials stay in `.env` only).

## Chosen defaults (locked by spike)

| Decision | Choice |
|----------|--------|
| FTS tokenizer | `porter unicode61` |
| FTS columns | `entry_id UNINDEXED`, `title`, `meta`, `abstract_text` (empty unless gate on) |
| Ranking | `bm25(entry_fts) ASC`, tie-break `title ASC` |
| Query sanitization | alphanumeric tokens ≥2 chars; FTS as quoted prefix terms joined by AND |
| Pagination | page size 10; `page` query param |
| LIKE fallback | `lower(title|meta) LIKE %needle%` after stripping `%`/`_`; used when FTS missing/errors or `fallback=1` |
| Snapshot replace (fixture scale) | In-place: delete content tables → insert → drop/recreate FTS. No binding swap required at spike scale. |
| Abstract policy | Off by default; rights review required before production enablement |

## Latency evidence (fixture only — not a 5,643-row prediction)

Local smoke:
```json
{
  "at": "2026-08-07T00:27:56.905Z",
  "elapsedMs": 8406,
  "entryCount": "[\n  {\n    \"results\": [\n      {\n        \"c\": 12\n      }\n    ],\n    \"success\": true,\n    \"meta\": {\n      \"duration\": 0\n    }\n  }\n]\n",
  "ftsCount": "[\n  {\n    \"results\": [\n      {\n        \"c\": 12\n      }\n    ],\n    \"success\": true,\n    \"meta\": {\n      \"duration\": 1\n    }\n  }\n]\n",
  "valuesMatch": "[\n  {\n    \"results\": [\n      {\n        \"entry_id\": \"aaaaaaaa00000001\"\n      }\n    ],\n    \"success\": true,\n    \"meta\": {\n      \"duration\": 1\n    }\n  }\n]\n",
  "likeDefusion": "[\n  {\n    \"results\": [\n      {\n        \"id\": \"aaaaaaaa00000002\"\n      }\n    ],\n    \"success\": true,\n    \"meta\": {\n      \"duration\": 0\n    }\n  }\n]\n"
}
```

Staging smoke:
```json
{
  "at": "2026-08-07T00:27:06.500Z",
  "results": {
    "entryCount": {
      "elapsedMs": 1995,
      "stdout": [
        {
          "results": [
            {
              "c": 12
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.7316
            },
            "duration": 0.7316,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 12,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "ftsCount": {
      "elapsedMs": 1935,
      "stdout": [
        {
          "results": [
            {
              "c": 12
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.3731
            },
            "duration": 0.3731,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 12,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "manifest": {
      "elapsedMs": 1944,
      "stdout": [
        {
          "results": [
            {
              "contract_version": "1",
              "schema_version": "1",
              "entry_count": 12,
              "abstract_search_enabled": 0
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.2822
            },
            "duration": 0.2822,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 1,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "valuesMatch": {
      "elapsedMs": 1914,
      "stdout": [
        {
          "results": [
            {
              "entry_id": "aaaaaaaa00000001"
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.559
            },
            "duration": 0.559,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 1,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "abstractLeakCheck": {
      "elapsedMs": 1918,
      "stdout": [
        {
          "results": [
            {
              "c": 0
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.44
            },
            "duration": 0.44,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 0,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "likeDefusion": {
      "elapsedMs": 1926,
      "stdout": [
        {
          "results": [
            {
              "id": "aaaaaaaa00000002"
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.3202
            },
            "duration": 0.3202,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 13,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "alias": {
      "elapsedMs": 1913,
      "stdout": [
        {
          "results": [
            {
              "canonical_id": "aaaaaaaa00000001"
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.4949
            },
            "duration": 0.4949,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 1,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    },
    "ftsCountAfterRebuild": {
      "elapsedMs": 1955,
      "stdout": [
        {
          "results": [
            {
              "c": 12
            }
          ],
          "success": true,
          "meta": {
            "served_by": "v3-prod",
            "served_by_region": "WNAM",
            "served_by_colo": "SJC",
            "served_by_primary": true,
            "timings": {
              "sql_duration_ms": 0.3769
            },
            "duration": 0.3769,
            "changes": 0,
            "last_row_id": 12,
            "changed_db": false,
            "size_after": 131072,
            "rows_read": 12,
            "rows_written": 0,
            "total_attempts": 1
          }
        }
      ]
    }
  },
  "ftsRebuildMs": 2228
}
```

Acceptance for this spike: fixture FTS/LIKE queries complete successfully locally and remotely; no hard latency SLA claimed for full corpus.

## Explicitly deferred to 1B+

- Structured ACT verification tables / backfill from `notes`
- Dedupe alias production from live merges
- Field-level rights states for abstracts
- Deterministic full 5,643-row SQL snapshot + checksum pipeline
- Staging→production promotion/rollback runbook
- Public UI polish, `/standard/`, domains, SEO surfaces

## Stop

Phase 1A ends here. Do not start 1B until this record is accepted.
