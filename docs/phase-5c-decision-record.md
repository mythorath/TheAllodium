# Phase 5C Decision Record

Generated: 2026-09-03T09:43:57.726Z

## What this phase proved

Credibility is a deterministic, explainable allow-list score whose absences remain neutral.

## Required artifacts

- `src/credibility/score.ts`
- `tests/credibility.test.ts`
- `docs/credibility-standard-v1.md`

## Exit gate

- `npm run secrets:scan`, `npm run typecheck`, and `npm test` pass.
- Existing psychotherapy routes and publication contract remain available.
- Upstream and authority failures degrade to explicit uncertainty, never fabricated negative evidence.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not claim
that every upstream index answered, that the authority snapshot is current,
or that a production deploy occurred. Those facts require timestamped
evidence and are reported separately.
