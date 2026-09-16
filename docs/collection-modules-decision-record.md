# Collection modules decision record

Generated: 2026-09-16

## What this phase proved

Outside authors can ship a whole site section as one archive: collection-neutral
D1 rows (publication contract v2) plus a `defineCollection()` route table.
The host validates the bundle, installs a dedicated D1 binding, and mounts
the module at `/<slug>` without changing psychotherapy v1.2.

## Required artifacts

- `collection-migrations/0001_core.sql` and `0002_fts.sql`
- `src/collections/contract-v2.ts`, `module.ts`, `mount.ts`, `db.ts`
- `scripts/validate-collection.ts`, `scripts/install-collection.ts`
- `collection-kit/` (SPEC, AGENTS prompt, types, schema, validator, example)
- `docs/collection-module-contract-v1.md`
- `docs/collection-two-playbook.md`

## Exit gate

- `npm run typecheck` and `npm test` pass, including the minerals fixture
  exercised only in tests.
- Psychotherapy publication contract remains `1.2` with
  `therapy_modality` and `audience`.
- `INSTALLED_COLLECTION_MODULES` stays empty; the example is not deployed.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not
create remote collection D1s, deploy a second live collection, or claim
that contributed TypeScript is sandboxed. Intake remains review-gated
and staging-first.
