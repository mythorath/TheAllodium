# Incident: wrong PMCID caused "Open source" links to point at the wrong paper

Reported: 2026-08-12, entry `e6f4170c0a574a4f`
(`/psychotherapy/entries/e6f4170c0a574a4f`) linked to
`https://pmc.ncbi.nlm.nih.gov/articles/PMC13240989/`, which is a completely
different paper from the one titled and cited on the entry page.

## Root cause

Two independent bugs in ACT's PubMed Central harvester
(`scripts/act_lib/crawl/research.py`, `_fetch_pmc_metadata()`):

1. **Wrong attribute value.** NCBI's efetch XML tags an article's own PMC
   identifier as `<article-id pub-id-type="pmcid">`. The harvester checked
   for `pub-id-type="pmc"`, which essentially never matches. In practice
   this lookup always returned nothing.
2. **Unsafe positional fallback.** When the (always-failing) lookup above
   came back empty, the code fell back to `f"PMC{pmc_ids[idx]}"`: the
   `idx`-th id of the *originally requested* batch, assumed to line up
   with the `idx`-th `<article>` in NCBI's response. That assumption isn't
   safe: a single missing/embargoed/moved id in a batch shifts every
   later index out of alignment, silently attaching one paper's real
   PMCID to a different paper's DOI/title/abstract.

Because bug 1 always fired, bug 2's positional guess effectively became
the *only* way PMCIDs were ever assigned for anything harvested through
this path (`source_org = 'PubMed Central'`, 2,316 rows): correct only by
coincidence when a batch happened to come back in request order. DOI
extraction used the standard, always-present `pub-id-type="doi"` and was
never affected, which is why the entry's title/DOI/identity verification
were all correct and only the PMCID (and the `canonical_url` derived from
it) was wrong.

The bug did not affect the 143 rows harvested via Europe PMC
(`enrich_europe_pmc()`), which reads `pmcid` directly from JSON.

## Fix (act repo)

- `scripts/act_lib/crawl/research.py`: extraction now looks for
  `pub-id-type` in `("pmcid", "pmc")`, scoped to
  `front/article-meta` (so a `<sub-article>`'s own ids can never be
  picked up), and the positional fallback was removed entirely, if an
  article's own id truly isn't present, `pmcid` stays unset rather than
  guessed.
- `scripts/fix_pmcid_conflicts.py` (new): no-network regression check,
  flags any `pmcid` shared across rows with different DOIs. Safe to
  re-run anytime; a clean corpus reports zero conflicts.
- `scripts/verify_pmcid_doi.py` (new): live check against NCBI's
  [PMC ID Converter](https://pmc.ncbi.nlm.nih.gov/tools/idconv/),
  for every stored `pmcid`, confirms NCBI actually associates it with the
  row's own DOI. Catches wrong PMCIDs that don't happen to collide with
  another row in our corpus (which is what the originally reported entry
  was, the paper that PMC13240989 really belongs to was never harvested
  into our database at all, so `fix_pmcid_conflicts.py` alone couldn't
  have caught it).

Both scripts only ever *clear* an untrustworthy `pmcid` (and, when it was
derived from that same wrong id, `source_url`). They never write a
guessed replacement. `act_lib/catalog.py`'s `_canonical_link()` then falls
back to the row's independently-verified `oa_url`, or its DOI resolver,
both already validated separately from PMCID.

## Remediation (data)

- `fix_pmcid_conflicts.py`: 135 rows across 67 `pmcid` values shared by
  ≥2 different DOIs.
- `verify_pmcid_doi.py`: a further 2,239 rows whose stored `pmcid`
  resolved, per NCBI, to a different DOI than the one already stored
  (11 rows with a pmcid but no DOI to check against were left untouched;
  6 pmcids that didn't resolve via NCBI were left untouched).
- Net: **2,374 rows** had their `pmcid`/`source_url` cleared; **0** of
  those had their `title` or `doi` touched.
- Re-running both scripts afterward reports zero remaining conflicts and
  zero remaining mismatches.

## Promotion

- Re-exported the snapshot from the corrected `act.db`
  (`export_allodium_snapshot.py`): same 5,643 public-safe entries,
  same tag/verification/neighbor counts as before the fix.
- `npm run diff:links` against the live corpus showed exactly
  **1,885 `canonical_url` changes, 0 `title` changes** on entries already
  live (the gap vs. 2,374 is rows excluded from the public snapshot, e.g.
  `verification_status = 'rejected'`, or whose fallback resolved to the
  same URL as before).
- Promoted to staging, then production, with
  `--acknowledge-link-changes`. Post-promotion smoke checks passed in
  both environments; `npm run smoke:live -- --url https://theallodium.org`
  passed all 35 checks.
- Confirmed live: `/psychotherapy/entries/e6f4170c0a574a4f` now links to
  `https://doi.org/10.2196/91751`, matching its title.

## Follow-ups (not done here)

- The ~220 rows still carrying a `pmcid` were independently confirmed
  correct against NCBI (or intentionally left alone, no DOI to check, or
  NCBI didn't resolve the id). No action needed unless new harvests
  reintroduce a mismatch, which the two verification scripts above would
  now catch.
- Recovering the *true* PMCID for the 2,374 corrected rows (rather than
  leaving `pmcid` empty) would require a per-DOI reverse lookup; out of
  scope here since `canonical_url` no longer depends on it and the public
  entry page already shows `PMCID: Not recorded` gracefully for rows without one.
- Consider wiring `fix_pmcid_conflicts.py` into `verify_corpus.py`'s
  deterministic gates (it's fast and network-free) so a future
  regression is caught automatically rather than by user report.
