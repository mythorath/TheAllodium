# Allodium collection module spec

This kit describes a **collection module**: public catalog data plus the
TypeScript routes and views that render it. The host Worker mounts your
module at `https://theallodium.org/<slug>` against a dedicated D1 database.
Psychotherapy (`/psychotherapy`, publication contract v1.2) is not this
contract and must not be modified.

## Honest boundary

Your TypeScript runs inside the host Worker. Cloudflare does not sandbox
per-module. The host therefore:

- never passes `c.env`, `DB`, `AUTHORITY`, `OG_CARDS`, or
  `GPU_SHARED_SECRET` to your handlers
- gives you a read-only `db` facade that only runs `SELECT`
- rejects `c.env`, `process.env`, `eval`, `fetch`, dynamic `import()`, and
  imports outside `hono/jsx` and `@allodium/collection`
- installs staging-first with Time Travel rollback

This is review-gated trust. It is strong against mistakes. It is not a
defense against a deliberately malicious contributor.

## Bundle layout

An unpacked collection is a directory:

| Path | Required | Role |
|------|----------|------|
| `collection.json` | yes | Module metadata. `moduleContract` must be `"1"`. |
| `import.sql` | yes | Snapshot rows for the collection-neutral schema |
| `manifest.json` | yes | Counts and the row-set checksum |
| `checksum.txt` | yes | SHA-256 hex of the **bytes** of `import.sql` |
| `src/index.tsx` | yes | `export default defineCollection({...})` |

Optional extra files under `src/` are allowed if they stay inside `src/`
and only import allowlisted modules or relative files.

Total `.ts`/`.tsx` source must be ≤ 512,000 bytes.

## `collection.json`

```json
{
  "slug": "minerals",
  "label": "Minerals",
  "lede": "One or two sentences, ≤ 280 characters.",
  "icon": "atom",
  "facetCategories": ["topic", "era"],
  "nav": [{ "path": "/search", "label": "Search" }],
  "shortlistPath": null,
  "advisoryPath": null,
  "moduleContract": "1"
}
```

- `slug` matches `^[a-z][a-z0-9-]{1,47}$` and is not a reserved host prefix
  (`psychotherapy`, `search`, `open-index`, `about`, `api`, …).
- `icon` is `index`, `atom`, or `orbit`.
- `facetCategories` are tag categories stored in `tags.category`. There is
  no `therapy_modality` column and no `audience` enum.
- `nav[].path` is relative to the collection mount (`/search`, not
  `/minerals/search`).

The D1 binding name is derived: `COLLECTION_<SLUG>` with hyphens turned
into underscores, e.g. `minerals` → `COLLECTION_MINERALS`.

## Data contract (publication v2)

`import.sql` must insert into the collection-neutral schema
(`collection-migrations/0001_core.sql` on the host):

- `snapshot_manifest` — `contract_version` `'2'`, `schema_version` `'1'`,
  `collection` equal to the slug
- `entries` — allowlisted columns only
- `tags`, `entry_tags`, `entry_verifications`, `entry_aliases` (optional),
  `entry_search_documents`, `entry_neighbors` (optional)

Allowed `entries` columns:

`id`, `title`, `resource_type`, `source_org`, `canonical_url`, `author`,
`published_date`, `credibility_tier`, `is_link_only`, `citation_count`,
`oa_status`, `doi`, `pmid`, `pmcid`, `link_status`, `link_checked_at`,
`updated_at`, `authors_json`, `overview`

Forbidden anywhere in public rows: `notes`, `file_path`,
`extracted_text_path`, `abstract`, `abstract_text` as an **entry** field,
`rationale`, `license`, `content_hash`, `body`, `therapy_modality`.
`entry_search_documents.abstract_text` may exist but should be NULL unless
the host has enabled abstract search (default off).

Do not include `/tank/`, `/home/`, or `acbs-member-personal-use` in any
string value.

Referential integrity:

- unique `entries.id`
- `entry_tags.entry_id` / `tag_id` exist
- verifications, aliases, search documents, and neighbors point at real
  entry ids
- every `tags.category` is listed in `collection.json` `facetCategories`

`manifest.json` `checksum` is the SHA-256 of the canonical JSON of the
parsed row sets (entries, tags, entry_tags, verifications, aliases,
search documents, neighbors). It is **not** the SHA-256 of the SQL file.
`checksum.txt` is the SHA-256 of the SQL file bytes. Both must match.

`manifest.entry_count`, `tag_link_count`, and `alias_count` must match
the inserted rows.

The host rebuilds FTS5 from `entry_search_documents` after import. Do not
insert into `entry_fts` yourself.

## TypeScript module

```ts
import { defineCollection } from "@allodium/collection";

export default defineCollection({
  slug: "minerals",
  label: "Minerals",
  lede: "...",
  icon: "atom",
  binding: "COLLECTION_MINERALS",
  facetCategories: ["topic", "era"],
  nav: [{ path: "/search", label: "Search" }],
  routes: [
    { method: "GET", path: "/", handler: async (ctx) => { /* ... */ } },
  ],
});
```

Handlers are **not** Hono handlers. They receive `CollectionContext`:

- `slug`, `collection` (chrome for `Layout`)
- `request.method`, `url`, `params`, `query(name)`
- `db.query(sql, binds)` / `db.first(sql, binds)` — `SELECT` only
- `Layout` — the host page shell. Pass `collection={ctx.collection}`.

Return one of:

- `{ kind: "html", status?, body }` — JSX
- `{ kind: "redirect", status: 301 | 302, location }` — location must
  stay under `/<slug>`
- `{ kind: "json", status?, body }`
- `{ kind: "text", status?, body, contentType? }`

Rules:

- GET routes only
- route paths are relative (`/`, `/search`, `/entries/:id`)
- absolute hrefs in source must be `/<slug>` or `/<slug>/...`
- no `c.env`, `process.env`, `eval`, `Function`, `fetch`, `WebSocket`
- no `from "hono"` (use `hono/jsx` only)
- no `node:` or `fs` imports
- do not mention `GPU_SHARED_SECRET`

The host compiles with `jsxImportSource: "hono/jsx"`. You do not ship a
`package.json` in the bundle.

## Generate checksums, then validate

`manifest.json` and `checksum.txt` are generated, never hand-written:

```
node write-checksums.mjs .
node validate.mjs .
```

`write-checksums.mjs` also fills a literal `PLACEHOLDER_CHECKSUM` in
`import.sql`, because `snapshot_manifest.checksum` lives inside the SQL
that `checksum.txt` then covers. Re-run it after every edit to
`import.sql`, or the transport checksum will no longer match.

Fix every error `validate.mjs` reports. The host re-runs an equivalent set
of checks (`npm run collection:validate -- --dir <path>`) before install,
and that copy is authoritative.

## What the host does after intake

1. `collection:validate`
2. `collection:install -- --dir <path>` — create D1, patch `wrangler.jsonc`,
   register `src/contributed/<slug>`
3. `promote-snapshot.ts --env staging --snapshot-dir collection-modules/<slug>`
4. Staging smoke, then production with `--yes`

Nothing you ship is merged into psychotherapy's D1.
