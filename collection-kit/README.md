# Collection kit

Portable authoring kit for a third-party Allodium collection. No repository
clone is required. Hand the finished bundle to the host as
`<slug>.allodium-collection.tgz`.

## Files

- `SPEC.md` — the module contract an authoring agent must satisfy
- `AGENTS.md` — a drop-in prompt for an outside AI
- `types.d.ts` — `defineCollection` and public row types
- `collection.schema.json` — JSON Schema for `collection.json`
- `write-checksums.mjs` — writes `manifest.json` and `checksum.txt`
- `validate.mjs` — dependency-free validator (`node validate.mjs <dir>`)
- `snapshot-sql.mjs` — shared SQL parsing used by the two scripts above
- `example/` — a two-entry minerals collection that must pass validation

Everything runs on stock Node 18+. There is nothing to install.

## Authoring layout

```
collection.json
import.sql
manifest.json
checksum.txt
src/index.tsx
```

You write `collection.json`, `import.sql`, and `src/index.tsx` by hand.
`manifest.json` and `checksum.txt` are generated — the row-set checksum
cannot be computed by hand:

```bash
node write-checksums.mjs .   # after every edit to import.sql
node validate.mjs .          # must print "ok" before handoff
```

Pack those five artifacts (plus any extra `src/**/*.ts{,x}` files) as
`<slug>.allodium-collection.tgz`. Do not include host secrets, `wrangler`
config, or a copy of The Allodium Worker.
