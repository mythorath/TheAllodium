# Phase 5F Decision Record

Generated: 2026-09-03T09:43:57.727Z

## What this phase proved

DOI work pages resolve through the federation and no-DOI records use an explicit secondary identity tier.

## Required artifacts

- `src/federation/identity.ts`
- `src/views/open-index-pages.tsx`

## Exit gate

- `npm run secrets:scan`, `npm run typecheck`, and `npm test` pass.
- Existing psychotherapy routes and publication contract remain available.
- Upstream and authority failures degrade to explicit uncertainty, never fabricated negative evidence.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not claim
that every upstream index answered, that the authority snapshot is current,
or that a production deploy occurred. Those facts require timestamped
evidence and are reported separately.
