# Phase 5B Decision Record

Generated: 2026-09-03T09:43:57.726Z

## What this phase proved

Authority data has an independent D1 schema, deterministic snapshot builder, provenance, and read repository.

## Required artifacts

- `authority-migrations/0001_authority_schema.sql`
- `src/authority/repository.ts`
- `scripts/fetch-authority-sources.py`
- `scripts/build-authority-snapshot.py`
- `docs/authority-data.md`

## Exit gate

- `npm run secrets:scan`, `npm run typecheck`, and `npm test` pass.
- Existing psychotherapy routes and publication contract remain available.
- Upstream and authority failures degrade to explicit uncertainty, never fabricated negative evidence.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not claim
that every upstream index answered, that the authority snapshot is current,
or that a production deploy occurred. Those facts require timestamped
evidence and are reported separately.
