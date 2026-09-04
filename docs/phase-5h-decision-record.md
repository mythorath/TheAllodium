# Phase 5H Decision Record

Generated: 2026-09-03T09:43:57.727Z

## What this phase proved

The federation is available over MCP and the authority snapshot has scripts for licensed R2 and Zenodo distribution.

## Required artifacts

- `src/mcp.ts`
- `scripts/publish-authority-dump.ts`
- `scripts/publish-authority-zenodo.ts`

## Exit gate

- `npm run secrets:scan`, `npm run typecheck`, and `npm test` pass.
- Existing psychotherapy routes and publication contract remain available.
- Upstream and authority failures degrade to explicit uncertainty, never fabricated negative evidence.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not claim
that every upstream index answered, that the authority snapshot is current,
or that a production deploy occurred. Those facts require timestamped
evidence and are reported separately.
