# Open Index coverage

The Open Index is federated. It does not claim to contain every scholarly
record, and a source timing out does not make its records disappear from the
source itself. `/coverage` is the public source of truth for the adapters
currently queried, the authority snapshots used for scoring, and the gaps no
open interface can fill.

## Reachable live

The first production adapter set covers Crossref, Europe PMC, DataCite,
PubMed, DOAJ, HAL, arXiv, DOAB, and DBLP. Together these sources cover most
DOI-registered literature plus substantial biomedical, repository, preprint,
dataset, software, and thesis records. They overlap heavily; counts cannot be
added.

A Zenodo adapter is implemented and monitored, but the Phase 5A staging spike
proved that Zenodo returns 403 or times out from Cloudflare Worker egress.
It is therefore disabled in the public fan-out. Zenodo DOI metadata remains
reachable through DataCite rather than making every search partially fail.

The best available estimate is 60–70% of global scholarly output. This is an
estimate, not a measured recall figure: there is no complete denominator for
all scholarship. About 32% of OpenAlex's core works have no DOI, and those
works are disproportionately theses, repository deposits, humanities
material, and publications from under-indexed regions.

## Authority snapshots

The scoring layer holds small, redistributable reference datasets rather than
the complete work graph:

- OpenAlex venue, publisher, institution, and field-taxonomy entities
  (CC0)
- Research Organization Registry (CC0)
- DOAJ journal metadata (CC0)
- Retraction Watch notices (CC BY 4.0)
- NLM MEDLINE journal data (United States government/public domain)

Absence from any authority list is neutral. It is never transformed into a
claim that a work, venue, author, publisher, country, or language is not
credible.

## Named blind spots

- Chinese-language scholarship in CNKI and Wanfang: no free, redistributable
  public API.
- Humanities and social-science monographs: DOI registration and open search
  coverage are uneven.
- Standards from ISO, IEEE, ANSI, DIN, and peers: metadata and documents are
  generally proprietary or paywalled.
- Economics working papers in RePEc and philosophy records in PhilPapers: no
  stable open interface suitable for this public federation.
- National indexes in Russia, Korea, Iran, Indonesia, and Turkey remain
  incompletely represented by the broad aggregators.

OAI-PMH sources such as African Journals Online, LA Referencia, and SciELO
Preprints are a planned scheduled-harvest layer. OAI-PMH is not a relevance
search API and cannot be treated as a live adapter.

## Sources deliberately excluded

The Allodium does not use Cabells, Scopus, Web of Science, Kscien, Beall-list
archives, or the ISSN-L released-data file for scoring. They are proprietary,
unlicensed for redistribution, noncommercial/share-alike, or legally unsafe
for derived public labels. CORE and BASE also have licensing or network
constraints incompatible with this service.

## Monitoring

`npm run audit:federation` probes representative public endpoints, records
status and latency in `evidence/federation-health-*.json`, and exits nonzero
only when every probe fails. The daily cron wrapper logs this separately and
does not let a third-party outage fail the existing link-integrity audit.
