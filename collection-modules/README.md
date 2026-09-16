# Installed collection snapshots

Each installed collection's `collection.json`, `import.sql`, `manifest.json`,
and `checksum.txt` land here after `npm run collection:install`. Promote with:

```
npx tsx scripts/promote-snapshot.ts --env staging --snapshot-dir collection-modules/<slug>
```
