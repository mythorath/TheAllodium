# Collection module contract v1

Module contract version: `1`
Publication contract for contributed data: `2`
Host psychotherapy collection: publication contract `1.2` (untouched)

This contract is how an outside author — often an AI in another IDE — ships
a whole site section to The Allodium: public catalog rows plus the TypeScript
that renders them. The host mounts the module at `/<slug>` against a
dedicated D1 binding named `COLLECTION_<SLUG>`.

The authoring kit (`collection-kit/`) is the portable copy of this contract.
The host copy in `src/collections/` and `npm run collection:validate` is
authoritative.

## Honest boundary

Contributed TypeScript runs inside the Worker with full privileges.
Cloudflare offers no per-module sandbox. The host therefore:

- never passes `c.env`, `DB`, `AUTHORITY`, `OG_CARDS`, or
  `GPU_SHARED_SECRET` into a collection handler
- exposes only a `SELECT`-only database facade scoped to that collection's
  binding
- static-analyses every `.ts`/`.tsx` file for `c.env`, `process.env`,
  `eval`, `fetch`, dynamic `import()`, and imports outside `hono/jsx` and
  `@allodium/collection`
- installs staging-first with the existing Time Travel rollback

That is review-gated trust. It is strong against mistakes and sloppy
generation. It is not a defense against a deliberately malicious contributor.

## Bundle

An unpacked module is:

| Path | Role |
|------|------|
| `collection.json` | Metadata. `moduleContract` is `"1"`. |
| `import.sql` | Snapshot rows for `collection-migrations/` |
| `manifest.json` | Counts plus the **row-set** SHA-256 |
| `checksum.txt` | SHA-256 of the **bytes** of `import.sql` |
| `src/index.tsx` | `export default defineCollection({...})` |

See [collection-kit/SPEC.md](../collection-kit/SPEC.md) for field-level
rules, the entry allowlist, and forbidden keys (`therapy_modality` is
forbidden on v2 rows; psychotherapy keeps it on v1.2).

Facets are **tag categories**. `tags(name, category)` is generic.
A collection declares its categories in `collection.json`; there is no
psychotherapy `audience` enum on the v2 schema.

## Host interface

`src/collections/module.ts` exports `defineCollection()`. Handlers receive
`CollectionContext` (chrome, request, read-only `db`, host `Layout`) and
return `{ kind: "html" | "redirect" | "json" | "text", ... }`. They are
not Hono handlers.

The host adapter (`src/collections/mount.ts`) builds a Hono sub-app from
the route table and `app.route("/" + slug, sub)` in `src/index.tsx`. The
existing `app.use("*")` security-header and HTML cache middleware covers the
mount automatically.

Installed modules are listed in `src/collections/installed.ts`. The
minerals example under `fixtures/example-collection/` is **test-only**
and is never registered there.

## Intake

```bash
npm run collection:validate -- --dir path/to/unpacked
npm run collection:install -- --dir path/to/unpacked   # staging D1; add --yes for production
npx tsx scripts/promote-snapshot.ts --env staging --snapshot-dir collection-modules/<slug>
```

`collection:validate` writes `evidence/collection-validate-<slug>.json`.
Promote and smoke accept `--binding` so they no longer assume `DB`.

## Related

- [Publication contract v1 (psychotherapy)](publication-contract-v1.md)
- [Collection two playbook](collection-two-playbook.md)
- [Decision record](collection-modules-decision-record.md)
