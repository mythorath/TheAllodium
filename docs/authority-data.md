# Authority data

The Phase 5B authority database is an independently replaceable D1 snapshot.
It supports scoring and field mapping; it is not evidence that a paper or
organization is trustworthy. The schema is
`authority-migrations/0001_authority_schema.sql`.

## Sources, licenses, and cadence

- **OpenAlex** sources, publishers, institutions, and
  domain/field/subfield/topic taxonomy: CC0 1.0. Refresh quarterly. OpenAlex
  updates upstream data continuously; use a dated bulk snapshot or a
  reproducibly captured API extract.
- **ROR** organizations: CC0 1.0. Refresh quarterly from a versioned ROR data
  release. ROR location fields include GeoNames data under CC BY 4.0; this
  snapshot stores only country code from that location data.
- **Retraction Watch via Crossref**: CC BY 4.0. Refresh weekly. Preserve
  attribution to Retraction Watch/Crossref; Crossref publishes the complete
  CSV and updates it each working day.
- **DOAJ journal metadata**: CC0 1.0. Refresh monthly. This follows the current
  DOAJ terms for journal metadata (including the journal CSV and full dump),
  rather than the historical CC BY-SA terms.
- **NLM Catalog journal data**: US National Library of Medicine data terms.
  Refresh quarterly and retain the source URL and fetch timestamp. NLM data
  terms allow redistribution with the attribution “Courtesy of the U.S.
  National Library of Medicine”, no implication of NLM endorsement, and a
  notice that a dated snapshot does not reflect the most current NLM data.

License references:

- OpenAlex: <https://github.com/ourresearch/openalex-docs/blob/main/license.md>
- ROR: <https://ror.org/about/terms/>
- Crossref metadata terms:
  <https://www.crossref.org/documentation/retrieve-metadata/>
- DOAJ: <https://doaj.org/terms/>
- NLM:
  <https://www.nlm.nih.gov/databases/download/terms_and_conditions.html>

## Download boundary

`scripts/fetch-authority-sources.py` is only a bounded byte downloader. It does
not paginate an API, unpack an archive, normalize data, or build a snapshot.
It never discovers URLs, uses credentials, or invokes a shell. Each URL must
be supplied as `--url NAME=https://...` or through the corresponding
environment variable printed by `--help`. HTTPS, no embedded credentials, a
timeout, and a byte limit are enforced.

The OpenAlex URLs must point to complete, already captured small-entity JSON
files, not an API's first results page. This executable
download command covers every input family (set the URL environment variables
listed by `--help` first):

```sh
python scripts/fetch-authority-sources.py \
  --output-dir authority-raw/2026-09-01 \
  --source openalex_publishers \
  --source openalex_sources \
  --source openalex_institutions \
  --source openalex_domains \
  --source openalex_fields \
  --source openalex_subfields \
  --source openalex_topics \
  --source ror \
  --source retraction_watch \
  --source doaj \
  --source nlm
```

For example,
`AUTHORITY_RETRACTION_WATCH_URL=https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv`.
The command writes opaque raw files and `download-manifest.json`, including
the resolved URL, SHA-256, byte count, license, and UTC fetch time. A successful
download is not a build. Check the upstream format and then run the normalizer.
The default 512 MiB cap is a safety ceiling, not permission to fetch an entire
OpenAlex snapshot. Large OpenAlex bulk entities must be obtained and filtered
outside this script.

For a locally obtained OpenAlex Parquet extract:

```sh
python scripts/fetch-authority-sources.py \
  --output-dir authority-raw/2026-09-01 \
  --convert-parquet topics.parquet \
  --parquet-output authority-raw/2026-09-01/topics.jsonl
```

Conversion streams record batches and requires optional `pyarrow`. If absent,
the script prints the isolated-environment installation command. Converted
rows still require normalization to the contract below.

## Normalization command

`scripts/normalize-authority-sources.py` is the executable bridge from local
raw files to every exact filename consumed by the builder. It accepts OpenAlex
JSON arrays, API-shaped `{"results":[]}` captures, JSONL, or Parquet; ROR JSON
or its release ZIP; Retraction Watch CSV; DOAJ journal CSV or ZIP; and NLM
Catalog XML. Run all families together so the generated source manifest is
complete:

```sh
python scripts/normalize-authority-sources.py \
  --output-dir authority-normalized/2026-09-01 \
  --fetched-at 2026-09-01T00:00:00Z \
  --openalex-publishers authority-raw/2026-09-01/openalex-publishers.json \
  --openalex-sources authority-raw/2026-09-01/openalex-sources.json \
  --openalex-institutions authority-raw/2026-09-01/openalex-institutions.json \
  --openalex-domains authority-raw/2026-09-01/openalex-domains.json \
  --openalex-fields authority-raw/2026-09-01/openalex-fields.json \
  --openalex-subfields authority-raw/2026-09-01/openalex-subfields.json \
  --openalex-topics authority-raw/2026-09-01/openalex-topics.json \
  --ror authority-raw/2026-09-01/ror-release.zip \
  --retraction-watch authority-raw/2026-09-01/retraction-watch.csv \
  --doaj authority-raw/2026-09-01/doaj-journals.csv \
  --nlm authority-raw/2026-09-01/nlm-journals.xml
```

Override the five `--*-source-url` values when the raw files came from mirrors.
The normalizer writes all eleven normalized files plus a checksummed
`authority-source-manifest.json`. It does not download anything.

For a complete no-network smoke fixture:

```sh
rm -rf /tmp/allodium-authority-smoke
python scripts/normalize-authority-sources.py \
  --output-dir /tmp/allodium-authority-smoke/normalized \
  --fetched-at 2026-09-01T00:00:00Z \
  --smoke-fixture
python scripts/build-authority-snapshot.py \
  --input-dir /tmp/allodium-authority-smoke/normalized \
  --output-dir /tmp/allodium-authority-smoke/snapshot \
  --snapshot-id smoke-2026-09-01 \
  --snapshot-at 2026-09-01T00:00:00Z
python -m unittest tests/test_authority_snapshot.py
```

## Normalized input contract

The builder consumes normalized, UTF-8 JSONL/CSV, not raw upstream archives.
Every file is required, even when it contains zero rows. Rows must be uniquely
sorted by the stated key so the builder can stream them while producing
deterministic SQL.

All `*_json` values may be JSON values in JSONL or compact JSON strings in CSV.
Dates and provenance timestamps use RFC 3339. DOIs are stored without a
`doi:`/`doi.org` prefix and lowercased. ISSNs use `NNNN-NNNX`.

- `openalex_publishers.jsonl`, key `id`: `id`, `display_name`,
  `alternate_titles_json`, `country_codes_json`, `hierarchy_level`,
  `parent_publisher_id`, `works_count`, `cited_by_count`.
- `openalex_sources.jsonl`, key `id`: `id`, `display_name`, `issn_l`,
  `issns_json`, `host_organization_id`, `publisher_id`, `source_type`,
  `is_oa`, `is_in_doaj`, `works_count`, `cited_by_count`, `homepage_url`.
- `openalex_institutions.jsonl`, key `id`: `id`, `ror_id`, `display_name`,
  `country_code`, `institution_type`, `parent_institution_id`, `works_count`,
  `cited_by_count`.
- `openalex_domains.jsonl`, key `id`: `id`, `display_name`, `description`,
  `works_count`, `cited_by_count`.
- `openalex_fields.jsonl`, key `id`: the domain columns plus `domain_id`.
- `openalex_subfields.jsonl`, key `id`: the domain columns plus `field_id`.
- `openalex_topics.jsonl`, key `id`: `id`, `subfield_id`, `display_name`,
  `description`, `keywords_json`, `works_count`, `cited_by_count`.
- `ror_organizations.jsonl`, key `id`: `id`, `display_name`,
  `organization_types_json`, `country_code`, `status`, `established_year`,
  `website_url`, `aliases_json`, `labels_json`, `external_ids_json`.
- `retraction_watch_notices.csv`, key `id`: `id`, `doi`,
  `original_paper_doi`, `title`, `journal`, `publisher`, `notice_type`,
  `notice_date`, `original_paper_date`, `reason_json`.
- `doaj_journals.jsonl`, key `id`: `id`, `title`, `issn`, `eissn`,
  `publisher`, `country_code`, `added_on`, `last_updated`, `seal`,
  `license_json`, `subjects_json`.
- `nlm_journals.jsonl`, key `nlm_id`: `nlm_id`, `title`, `abbreviation`,
  `issn_print`, `issn_electronic`, `issn_linking`, `publisher`, `country`,
  `language_json`, `medline_ta`.

Missing optional fields become SQL `NULL`; JSON arrays/objects and `seal`
receive safe defaults. The builder rejects missing primary/display fields,
bad JSON, duplicate/out-of-order keys, unexpected files, and checksum
mismatches.

The input directory also requires `authority-source-manifest.json`:

```json
{
  "files": [
    {
      "filename": "openalex_sources.jsonl",
      "family": "openalex",
      "source_name": "OpenAlex",
      "source_url": "https://openalex.org/",
      "license_name": "CC0 1.0",
      "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "fetched_at": "2026-09-01T00:00:00Z",
      "sha256": "64-lowercase-hex-characters"
    }
  ]
}
```

It must contain exactly one entry for every normalized file. Metadata must be
identical among files in one family. The builder verifies each SHA-256 before
writing output.

## Build and import

```sh
python scripts/build-authority-snapshot.py \
  --input-dir authority-normalized/2026-09-01 \
  --output-dir authority-snapshots/2026-09-01 \
  --snapshot-id 2026-09-01 \
  --snapshot-at 2026-09-01T00:00:00Z

wrangler d1 execute DB --file=authority-migrations/0001_authority_schema.sql
wrangler d1 execute DB --file=authority-snapshots/2026-09-01/import.sql
```

`--snapshot-at` is explicit rather than using the wall clock. Given identical
input bytes and arguments, output is byte-for-byte identical. Output files are
atomically replaced:

- `import.sql`: ordered deletes, family manifests, and inserts. D1's import
  runner supplies batch handling; the file intentionally contains no
  unsupported explicit `BEGIN`/`COMMIT` statements.
- `import.sql.sha256`: standard SHA-256 checksum line for the SQL.
- `checksum.txt`: bare import SQL SHA-256 used by the R2 publication script.
- `manifest.json`: schema/snapshot identifiers, import and source-manifest
  checksums, and row counts.
- `licenses.json`: source, license, fetch timestamp, and included normalized
  files for every family; this travels with every distribution.

Each authority row references its family in `authority_manifest`; the manifest
preserves source URL, license, fetch time, source checksum, and per-file
checksums. Apply the schema first. Apply a snapshot to a staging D1 database,
verify manifest counts and representative lookups, then promote the same
checksum-tested SQL.

## Prohibited data

Do not ingest the ISSN International Centre's ISSN-L table or other
non-commercial/restricted ISSN exports. ISSN normalization here is formatting,
not ISSN-L derivation. Do not ingest proprietary journal, publisher, or
institution blacklists (including subscription-only watchlists), scraped
paywalled indexes, leaked datasets, or sources whose redistribution terms are
unknown. Authority signals must remain attributable, reviewable, and legally
redistributable.
