# Federation contract v1

Status: Phase 5A foundation  
Contract version: 1.0  
Policy review date: 2026-09-03

This contract governs live bibliographic discovery across independent upstream
services. It is a fail-open enrichment layer, not a source of record. A failed
or slow source must not make local search fail, and a remote result must never
silently become local curated content.

## 1. Normalized hit

`NormalizedWork` in `src/federation/types.ts` is the normative machine shape.
Every hit contains:

- bibliographic fields: title, structured authors, publication year/date,
  resource type, container, and publisher;
- identifiers: normalized DOI, arXiv ID, PMID, and PMCID where supplied;
- links and an open-access assertion, each nullable because absence is not
  evidence of a negative;
- one or more `SourceEvidence` records.

Null means “not asserted by the retained source,” not “known not to exist.”
Adapters must not invent missing metadata. `Untitled` and `Unknown` are parser
safety values and should not be promoted into durable records.

Abstract text is intentionally not a member of the normalized type. See
“Abstract non-redistribution” below.

## 2. Provenance

Each source observation carries:

- the stable source name and upstream record identifier;
- the upstream landing/API record URL when available;
- retrieval time in UTC ISO 8601;
- the upstream keys inspected for the observation;
- zero-based rank in that source response;
- the record-level licence URI/label when the source supplies one.

Merging preserves all distinct evidence, keyed by `(source, sourceId)`. The UI
must be able to name every contributing source. Provenance is not a claim that
the linked full text is open, licensed, correct, or clinically endorsed.

## 3. Adapter result and fail-open semantics

An adapter resolves to one `AdapterResult` and its public `search` function
must never reject. The result always includes source, original query, status,
hits, and an opaque next cursor.

Status is a discriminated union:

- `ok`: valid normalized response, including a legitimate zero-hit response;
- `timeout`: the adapter exceeded its hard wall-clock budget;
- `http-error`: non-2xx response, preserving status and parsed `Retry-After`;
- `network-error`: DNS, TLS, fetch, connection, or other transport failure;
- `invalid-response`: successful HTTP response that cannot satisfy the
  documented response shape;
- `invalid-query`: rejected locally before network I/O.

The default hard timeout is 5,000 ms for the complete adapter operation.
Timeout aborts in-flight fetches and also resolves on time when an injected or
non-conforming fetch ignores `AbortSignal`. Phase 5A performs no automatic
retry: retries can multiply upstream load and breach a user-facing latency
budget. A future orchestrator may retry 429/502/503/504 once, only after
`Retry-After` or full-jitter exponential backoff, and never inside the original
request after its deadline.

The federated response is partial if any selected adapter is not `ok`.
Successful hits from other adapters remain usable. Failure objects are
diagnostic; user-facing copy should say that some sources were unavailable and
must not imply “no literature exists.”

## 4. Query constraints

- Trim input; reject fewer than 2 or more than 500 Unicode characters.
- `pageSize` must be an integer and is clamped to 1–100.
- Treat user input as data. Encode it with `URLSearchParams` (and path encoding
  where an upstream API requires a path query). Do not interpolate operators,
  credentials, field names, or arbitrary upstream URLs.
- Pass only documented, allowlisted filters. Do not expose raw Solr/Lucene,
  Entrez, or provider-specific query syntax directly to an untrusted client.
- Cursors are source-specific opaque values. Never send one source’s cursor to
  another source. Numeric-only cursors are required for offset/page adapters.
- Reject unsupported wildcard-only, empty, control-character, or unbounded
  harvesting queries at the orchestration boundary.

The Phase 5A spike uses three fixed benign queries. It is diagnostic, not a
production endpoint or scheduled harvester.

## 5. Pagination

One adapter result represents one upstream page. `nextCursor: null` means no
next page is known. It does not prove the source is exhausted when the source
failed or omitted paging metadata.

- Crossref and Europe PMC use their returned cursor tokens.
- DataCite and DOAJ expose a contract cursor representing the next page number.
- PubMed uses the next `retstart` offset.
- Zenodo uses the next page number; HAL, arXiv, DOAB, and DBLP use bounded
  numeric offsets. These are contract cursors, not arbitrary next-page URLs.
- Future adapters must prefer cursor/resumption-token APIs over deep offsets
  where the provider offers them.

The caller must bind cursors to the normalized query, source, page size, and
contract version (for example, in a signed server token). It must cap an
interactive request to one page per source. Bulk harvests belong in upstream
bulk/OAI/snapshot channels, not this contract.

## 6. Identity and deterministic deduplication

### DOI identity

A DOI is trimmed, percent-decoded when valid, stripped of `doi:`,
`https://doi.org/`, or `https://dx.doi.org/`, stripped of trailing citation
punctuation, and lower-cased. It is accepted only if it matches
`10.<4–9 digits>/<non-space suffix>`. DOI comparison is case-insensitive.

An arXiv identifier gets the synthetic DOI
`10.48550/arxiv.<versionless-arxiv-id>` only as an identity key. A real
upstream DOI remains the displayed DOI. This follows arXiv’s DataCite DOI
pattern but does not assert that every historical record resolves.

### Fallback identity

When DOI matching is unavailable, identity is:

`NFKD(title without marks/punctuation) + first-author surname + four-digit year`

Case and repeated whitespace are folded. All three components are mandatory;
otherwise no fallback key is produced. This conservative key can still merge
distinct works with the same title/author/year or miss translated/corrected
metadata. Such merges must remain reversible through preserved provenance.

Works merge when either normalized DOI/synthetic DOI or fallback key matches.
Fallback also bridges a DOI-bearing source to a source that omitted the DOI.
Input is sorted before grouping; output and evidence are sorted, so permutations
of the same observations produce the same result.

## 7. Source-merging precedence

For conflicting scalar values, precedence is:

1. PubMed
2. Europe PMC
3. Crossref
4. DataCite
5. DOAJ
6. Zenodo
7. HAL
8. arXiv
9. DOAB
10. DBLP

This is deterministic operational precedence, not a universal quality ranking.
It favors domain-curated biomedical records, then registration agencies, then
repository/directory metadata. A higher-precedence non-null value wins; missing
fields are filled from lower-precedence evidence. Identifiers are normalized,
evidence is unioned, and no source may erase another source’s provenance.
Changing precedence is a contract change requiring fixtures and review.

## 8. Abstract non-redistribution

No adapter may put an upstream abstract, abstract fragment, full text, or
machine-readable substitute into `NormalizedWork`, logs, cache values, API
responses, evidence files, or durable local storage. An upstream licence for
metadata does not necessarily grant redistribution rights for an abstract.

If a later ranking stage uses abstracts, it must process them ephemerally in
memory, avoid telemetry payloads, discard them before return, and undergo a
source-by-source rights review. Display may link to the upstream record.
Locally authored summaries must be independently generated, clearly labelled,
and governed by the existing publication contract; they cannot be a close
paraphrase used to evade this rule.

## 9. Politeness, concurrency, and caching

- Identify requests where supported with a stable tool name and a monitored
  contact email. No secrets are required by Phase 5A.
- Default to at most one in-flight request per source and enforce a shared
  source/IP rate limiter across users and worker instances.
- Honor `Retry-After`, 429, and provider response rate-limit headers. Back off
  on repeated 5xx responses and open a short circuit rather than retrying.
- Use bulk dumps, OAI-PMH, or snapshots for indexing. Never crawl human pages
  when an API or bulk route exists.
- Cache normalized metadata/query pages, never abstract text. Suggested TTL:
  24 hours for successful interactive query pages, 7 days for identifier
  lookups, 30–120 seconds for zero results, and only 5–30 seconds for transient
  failures. Do not cache invalid queries.
- Cache keys include source, normalized query, filters, page size, cursor,
  parser version, and contract version. Apply bounded size, request coalescing,
  stale-while-revalidate, and deletion when upstream terms require it.
- A cache hit must retain original retrieval provenance and may add separate
  cache timing metadata; it must not rewrite `retrievedAt`.

## 10. 2026 upstream terms/limits matrix

This is an engineering policy snapshot, not legal advice. “Unknown” means no
stable numeric limit was located in official public documentation on the review
date. Limits and terms can change without versioning; production enablement
requires rechecking every linked official page, recording the review date, and
testing response headers. Conservative local limits below are recommendations,
not claims about provider quotas.

All ten sources below have Phase 5A adapters. Each adapter performs a single
bounded discovery page (except PubMed's documented ESearch + ESummary pair),
uses only official machine endpoints, accepts injected fetch for deterministic
testing, and returns failures as status data. Rate limiting remains a required
shared orchestration concern; the adapter registry alone does not schedule or
throttle concurrent callers.

### Crossref

- Channel: REST `/works`; public access, polite pool when a valid `mailto` is
  supplied. Metadata is broadly reusable subject to field-level third-party
  rights.
- 2026 documented limits: from 2026-07-21, list queries are 1 request/second
  public or 3/second polite; single records are 5/second public or 10/second
  polite. Public concurrency is 1 and polite concurrency is 3. Read
  `x-rate-limit-*` and `x-concurrency-limit`; 429 means slow down.
- Local policy: polite identification in production; one concurrent list
  request and no more than 1 list request/second.
- Source: https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/

### Europe PMC

- Channel: Articles REST for interactive search; OAI/FTP for permitted bulk
  routes. Do not crawl the site or bulk-download content outside allowed
  channels. Article/full-text rights remain record-specific.
- 2026 documented limits: no public numeric request rate located. REST page
  size defaults to 25 and is capped at 1,000; cursor pagination is available.
- Local policy: 1 request/second, one concurrent request, cursor paging, and no
  abstract retention. This local rate is deliberately conservative and is not
  an upstream guarantee.
- Source: https://europepmc.org/RestfulWebService

### DataCite

- Channel: public REST v2 `/dois`; authentication is not required for reads.
  Metadata rights are generally permissive, but related content is separate.
- 2026 documented limits: 500 requests/5 minutes/IP unidentified; 1,000/5
  minutes/IP when a contact email is in User-Agent or `mailto`; 3,000/5
  minutes/IP authenticated. Rate limiting returns 429. July 2026 retired legacy
  endpoints, so this contract uses `/dois`.
- Local policy: identified requests, one concurrent request, <=100/minute.
- Source: https://support.datacite.org/docs/rate-limit

### PubMed / NCBI E-utilities

- Channel: ESearch plus ESummary at
  `eutils.ncbi.nlm.nih.gov`; send `tool` and `email`. PubMed citation metadata
  and publisher abstracts/content have different rights.
- 2026 documented limits: 3 requests/second/IP without a key, 10/second with an
  API key; jobs over 100 requests should run weekends or 21:00–05:00 US Eastern.
  Higher rates require NCBI approval.
- Local policy: no API key in Phase 5A, one concurrent adapter operation and
  <=1 operation/second (an operation can issue two E-utility requests).
- Source: https://www.ncbi.nlm.nih.gov/home/about/policies/

### DOAJ

- Channel: API v4 search; public article metadata and open-access links.
  Article licences remain record-specific.
- 2026 documented limits: 2 requests/second on all API routes; bursts up to 5
  are queued if the average remains 2/second.
- Local policy: one concurrent request and <=1 request/second.
- Source: https://doaj.org/api/v4/docs

### Zenodo

- Channel: REST for interactive lookup, OAI-PMH for harvesting. Record metadata
  is generally open; files use deposited record-level licences.
- Adapter: `GET https://zenodo.org/api/records` with `q`, `size`, and numeric
  `page`; normalizes InvenioRDM `hits.hits`, record PID/DOI, creators, rights,
  access status, and links. Description fields are neither copied nor exposed.
- 2026 documented limits: official docs confirm rate limiting and 429 but the
  reviewed page does not state a stable numeric quota. OAI pages contain 50
  records and resumption tokens are valid for only 2 minutes.
- Local policy: one concurrent request, <=1 request/second, honor headers and
  token expiry; do not infer file rights from repository membership.
- Source: https://developers.zenodo.org/

### HAL

- Channel: official Search API for discovery and OAI-PMH for harvesting; do not
  automate the protected human site. Rights can differ by record/file.
- Adapter: `GET https://api.archives-ouvertes.fr/search/` with JSON output,
  bounded `rows`/`start`, and an explicit `fl` allowlist. Abstract and full-text
  fields are not requested.
- 2026 documented limits: no official numeric request rate located. Search
  defaults to 30 rows, permits up to 10,000, and recommends cursors for several
  thousand results.
- Local policy: one concurrent request, <=1 request/second, small pages, cursor
  walks only; use OAI for bulk.
- Source: https://api.archives-ouvertes.fr/docs/search

### arXiv

- Channel: Query API for discovery and OAI-PMH for bulk metadata. Respect API
  terms and record/file licences.
- Adapter: `GET https://export.arxiv.org/api/query` with a quoted/escaped
  all-fields term and bounded `start`/`max_results`; normalizes Atom entries,
  versionless arXiv IDs, real DOIs, authors, dates, categories, and links.
  `<summary>` is deliberately ignored.
- 2026 documented limits: legacy Query API, RSS, and OAI-PMH together permit no
  more than one request every 3 seconds across all machines under the user’s
  control, with one connection at a time. Circumvention by extra hosts is
  prohibited.
- Local policy: global per-operator limiter, one connection, >=3.1 seconds
  between requests.
- Source: https://info.arxiv.org/help/api/tou.html

### DOAB

- Channel: REST search for discovery; OAI-PMH at
  `https://directory.doabooks.org/oai/` for harvesting. Book/file licences are
  record-specific even though entries describe open-access books.
- Adapter: `GET https://directory.doabooks.org/rest/search` with metadata
  expansion and bounded limit/offset; normalizes only an allowlist of Dublin
  Core bibliographic and rights keys. `dc.description.abstract` is ignored.
- 2026 documented limits: no official numeric quota located on the REST/OAI
  documentation reviewed. Therefore any numeric claim is uncertain.
- Local policy: one concurrent request, <=1 request/second, honor 429 and
  `Retry-After`, and contact OAPEN before sustained harvesting.
- Sources: https://doabooks.org/en/article/api-search-doab and
  https://www.doabooks.org/en/article/metadata

### DBLP

- Channel: publication Search API; full XML dump for large-scale querying.
  Respect `robots.txt` and DBLP’s data licence/terms.
- Adapter: `GET https://dblp.org/search/publ/api` with JSON format and bounded
  `h`/`f`; normalizes publication info, author names, DOI, venue, year, access,
  and canonical record link.
- 2026 documented limits: no fixed quota is published. DBLP says waiting 1–2
  seconds between requests should be safe; excessive use returns 429 with
  `Retry-After`. Search hits are capped at 1,000 per response.
- Local policy: one concurrent request, >=2 seconds between requests, use the
  XML dump rather than deep API crawling.
- Sources: https://dblp.org/faq/Am+I+allowed+to+crawl+the+dblp+website and
  https://dblp.org/faq/How+to+use+the+dblp+search+API

## 11. Production gate

Phase 5A supplies only the contract, pure identity/merge logic, ten fail-open
adapters, tests, and a manually invoked spike. Before serving live traffic:

1. revalidate terms and limits, especially every “unknown” entry;
2. add distributed per-source rate limiting, cache, request coalescing, and
   circuit breakers;
3. add SSRF-safe signed cursor envelopes and orchestration budgets;
4. run the spike manually from a non-production environment with a monitored
   contact email, retain only its metadata evidence, and inspect 429 headers;
5. complete privacy, accessibility, security, and user-copy review.
