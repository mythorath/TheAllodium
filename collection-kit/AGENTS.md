# Collection authoring agent

You are authoring a **collection module** for The Allodium. Read
`SPEC.md` and `types.d.ts` first. Produce a directory that `node validate.mjs <dir>`
accepts.

## Goal

Build one complete collection:

- `collection.json` with `moduleContract: "1"`
- `import.sql` for the collection-neutral D1 schema (publication contract v2)
- `manifest.json` and `checksum.txt`
- `src/index.tsx` that `export default defineCollection({...})`

Pack those files. Do not include Worker secrets, `.env`, or Allodium
host source.

## Constraints you must not violate

- Handlers are pure `CollectionHandler`s. Never accept a Hono `Context`.
  Never read `c.env` or `process.env`. Never call `fetch`, `eval`, or
  dynamic `import()`.
- `db` is read-only. Only `SELECT`. No writes, no DDL, no multiple
  statements.
- Import only `hono/jsx` and `@allodium/collection`, or relative files
  inside `src/`.
- Facets are tag categories. Do not add `therapy_modality` or
  `audience`.
- Do not claim the slugs `psychotherapy`, `search`, `open-index`,
  `about`, `api`, `works`, `venues`, or other reserved host prefixes.
- Absolute links in TSX must stay under `/<slug>/`.
- Public rows contain no file paths, notes, abstracts-as-entry-fields,
  or rationale.
- Use public-domain or clearly linkable metadata. Prefer `overview`
  paraphrases, not copied abstracts.

## Routes to ship

At minimum:

- `GET /`: collection home with a count and a link to search
- `GET /search`: optional `?q=` full-text query via `entry_fts`, else
  a title listing
- `GET /entries/:id`: one entry, 404 text if missing

Use `ctx.Layout` for HTML. Pass `collection={ctx.collection}` and a
`canonicalPath` under `/<slug>`.

## Validation

After every edit to `import.sql`:

```
node write-checksums.mjs <dir>
node validate.mjs <dir>
```

Do not hand off until `validate.mjs` prints `ok`. Never hand-edit
`manifest.json` or `checksum.txt`.

If the host later rejects the bundle, read the error, fix the bundle,
and re-validate. Do not ask the host to weaken the gate.
