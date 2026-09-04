# Credibility standard v1

Version: `1.0.0`

This standard is a transparent evidence summary, not a verdict on whether a
claim is true. It scores only normalized metadata and authority results supplied
to the pure scorer. The scorer performs no network access, name matching, or
reputation inference.

## Interpretation

The score starts at 50 and is clamped to 0–100. Every contribution is returned
as an ordered signal so a reader can expand the composite and inspect its
evidence, source, source license, polarity, and policy version.

- 0–29 — `serious-concern`: one or more serious warnings require inspection.
- 30–49 — `limited-evidence`: adverse or incomplete evidence outweighs support.
- 50–69 — `uncertain`: the available signals do not justify a stronger summary.
- 70–84 — `supported`: several independent authority signals support the record.
- 85–100 — `strongly-supported`: broad authority support is present.

Scores compare the evidence supplied to this policy, not scientific quality
across disciplines. A high score does not validate methods or conclusions. A
low score can reflect sparse metadata or a warning requiring human review.

## Policy and contributions

Positive authority matches are additive: DOI registration +5, DOI resolution
+5, DOAJ +8, MEDLINE +8, OpenAlex `is_core` +5, a known-publisher allow-list
match +4, and a ROR affiliation match +4. Open-access status and a supplied
publication license each add +2; version of record adds +3. Complete descriptive
metadata adds +4.

An explicitly checked DOI that is unregistered contributes -2, and one that
does not resolve contributes -3. A preprint contributes -4 because its record
may change, not because preprints are inherently unreliable. Partially complete
metadata contributes -2 and substantially incomplete metadata -6.

Retraction Watch events remain separate, visible signals:

- retraction: -35
- expression of concern: -18
- correction: -6
- reinstatement: +30

A reinstatement does not delete or relabel the historical retraction signal.
Likewise, a retraction does not delete the indexed work. Interfaces must retain
the record and display the warning and event evidence.

## Allow-list methodology

DOAJ, MEDLINE, OpenAlex core-source, known-publisher, and ROR results are
allow-list signals. A positive match can support identity or institutional
context. No match contributes zero and is explicitly neutral. It must never be
rendered as “not credible,” because absence can result from scope, lag,
disciplinary coverage, spelling, identifier quality, or an unavailable lookup.

The publisher signal must come from a maintained, identified allow-list. The
scorer intentionally does not derive it from publisher text. ROR affiliation
also requires a supplied lookup result; it does not fuzzy-match affiliation
names. These constraints keep the scoring function deterministic and prevent
hidden network-dependent behavior.

This standard has no “predatory publisher” blacklist. Such lists can be opaque,
stale, disputed, overbroad, and procedurally unfair. They also invite a false
binary inference about individual works. Positive, attributable allow-list
evidence and concrete editorial events are more auditable. Specific documented
warnings can be added as versioned signals in a future policy; reputation by
absence cannot.

## Uncertainty and limitations

Every unperformed or indeterminate authority lookup produces a neutral signal
and a human-readable uncertainty entry. Unknown publication version and license
are also called out. A checked “no event found” result remains neutral because
authority coverage can be incomplete.

The policy does not inspect study design, statistical power, conflicts of
interest, peer-review quality, citation context, author identity, or the truth
of claims. Index inclusion is not endorsement. Open access and license
availability improve accessibility and transparency but do not establish
validity. Corrections vary widely in severity. Retraction Watch matching and
event classification must be performed upstream and may require human review.

Metadata completeness checks six groups: title, at least one author, publication
date, DOI or canonical URL, publisher, and known publication version. It measures
record identifiability only.

## Evidence and license provenance

Each authority result must carry a concise evidence statement, source name, and
the license governing that source snapshot. The output signal preserves those
fields verbatim. Callers should identify snapshots or retrieval dates in the
evidence where possible.

For work-derived signals, `source` is “Normalized work metadata.” Their `license`
field describes the provenance status of that input, not the work's publication
license. The publication's own license is reported in the license signal's
evidence. These two meanings must not be conflated.

When no authority result is supplied, the signal uses an explicit unknown
source/license marker. Consumers must not replace that marker with an assumed
license. The scorer contains no bundled authority data and grants no rights to
DOAJ, MEDLINE, OpenAlex, ROR, Retraction Watch, DOI registry, or publisher-list
data.

## Stability

Signal order, identifiers, weights, bands, and semantics are policy behavior.
Changes require a new policy version and updated tests. Given structurally equal
inputs, v1 returns the same ordered result without time, randomness, storage, or
network dependencies.
