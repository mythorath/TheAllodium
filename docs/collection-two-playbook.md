# Collection two playbook

Roadmap item `collection-two-playbook`: adding a second curated collection
as a new D1 binding and path route on the same Worker.

Psychotherapy stays on publication contract v1.2, schema `migrations/`,
and binding `DB`. A new collection is a **collection module** (module
contract v1, publication contract v2) on `COLLECTION_<SLUG>` and
`/<slug>`. Split into a dedicated Worker only if the code has diverged
enough that sharing the host would cost more than it saves. Until then,
stay on this Worker and this zone.

## Path A — contributed module (preferred)

An outside author, often an AI in another IDE, receives
`collection-kit/allodium-collection-kit.tgz` (or this repo). They return
`<slug>.allodium-collection.tgz`.

On the host:

1. Unpack and run `npm run collection:validate -- --dir <unpacked>`.
   This checks `collection.json`, SQL-byte and row-set checksums,
   referential integrity, the v2 allowlist, and static analysis.
2. `npm run collection:install -- --dir <unpacked>`
   creates `theallodium-<slug>-staging` (and production with `--yes`),
   patches `wrangler.jsonc`, copies TypeScript to `src/contributed/<slug>`,
   and registers the default export in `src/collections/installed.ts`.
   The home page and `collectionForPath` pick it up automatically.
3. Promote staging-first, same Time Travel discipline as psychotherapy:

   ```bash
   npx tsx scripts/promote-snapshot.ts --env staging \
     --snapshot-dir collection-modules/<slug>
   npx tsx scripts/promote-snapshot.ts --env production --yes \
     --snapshot-dir collection-modules/<slug>
   ```

4. Deploy the Worker (`npm run deploy:staging`, then production). The
   mount is `app.route("/" + slug, sub)`; security headers already apply.
5. `npm run audit:links` against the live origin after deploy, plus the
   existing live-smoke suite.

Known gap: `src/sitemap.ts` still enumerates psychotherapy and the Open
Index only, so a contributed collection's entry pages are reachable and
linked but not listed in `sitemap.xml`. Extending the sitemap per
collection is follow-up work, not part of intake.

`--skip-remote` on install patches the repo without creating D1s, which
is useful for reviewing the TypeScript before spending a database.

## Path B — first-party, same as psychotherapy historically

If the second collection is authored in this repo rather than handed over
as a tarball, still use the module interface (`defineCollection`, v2
schema, `collection-migrations/`). Do not add `therapy_modality` to a
new collection, and do not fork `src/index.tsx` with a second copy of the
psychotherapy routes. Porting psychotherapy itself onto `defineCollection`
is optional later, not a requirement of collection two.

## When to split Workers

Stay on one Worker while:

- the collections share `Layout`, security headers, and the Open Index
- the new collection's TypeScript is a route table, not a second app
- D1 size and Worker CPU stay inside the current plan

Split only if the new collection needs a different runtime, a different
zone, or a privilege boundary Cloudflare actually enforces. Review-gated
trust is the boundary we have today; a second Worker does not create a
sandbox either unless the accounts and secrets are also split.

## Subject of collection two

Still an open product decision. The minerals fixture exists only to prove
the contract in tests. It is not a live collection.
