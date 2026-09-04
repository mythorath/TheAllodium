# Phase 5A Decision Record

Generated: 2026-09-03T09:43:57.693Z

## What this phase proved

The normalized adapter contract, fail-open behavior, identity strategy, and repeatable latency spike exist.

## Measured evidence

Evidence was captured on 2026-09-03 in
`evidence/federation-spike-local.json`,
`evidence/federation-spike-edge.json`, and the timestamped federation-health
record.

- Three local five-adapter fan-outs returned HTTP 200 from Crossref, Europe
  PMC, DataCite, PubMed, and DOAJ. Crossref took 315–514 ms, PubMed 415–462
  ms, DataCite 362–1,511 ms, DOAJ 264–384 ms, and Europe PMC 425–5,683 ms.
- Three uncached staging Worker requests returned 42–74 merged works. Crossref
  took 313–774 ms and PubMed 738–1,124 ms. Neither returned an upstream 429.
- The final nine-source staging smoke returned 51 merged works with no partial
  failure; adapter latency ranged from 293 ms (arXiv) to 2,427 ms (DOAB).
- Zenodo returned HTTP 403 from Worker egress and timed out after 8 seconds
  locally. Its adapter remains implemented and monitored, but is disabled in
  public fan-out; DataCite supplies Zenodo DOI metadata.

## Egress-rate decision

These measurements falsify the claim that Cloudflare Worker egress is
*always* rejected or immediately placed in an exhausted Crossref/PubMed
bucket. They cannot prove that unrelated Cloudflare tenants never share a
provider-side rate bucket; that property is controlled by the providers and
is not observable from one account. The architecture therefore proceeds with
a per-source Durable Object token bucket, Cache API plus KV, explicit 429
status reporting, and continuous health evidence. A future observed upstream
429 is a source-health event, not zero search results.

## Terms decision

The source-by-source terms and redistribution matrix is in
`docs/federation-contract-v1.md`. The public response redistributes
bibliographic metadata and provenance only. Abstracts and full text are not
stored or returned. Sources requiring commercial licenses, fixed-IP
allowlisting, or nonredistributable indexes are excluded.

## Required artifacts

- `docs/federation-contract-v1.md`
- `src/federation/types.ts`
- `src/federation/adapters.ts`
- `scripts/spike-federation.ts`
- `tests/federation.test.ts`

## Exit gate

- `npm run secrets:scan`, `npm run typecheck`, and `npm test` pass.
- Existing psychotherapy routes and publication contract remain available.
- Upstream and authority failures degrade to explicit uncertainty, never fabricated negative evidence.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not claim
that every upstream index answered, that the authority snapshot is current,
or that a production deploy occurred. Those facts require timestamped
evidence and are reported separately.
