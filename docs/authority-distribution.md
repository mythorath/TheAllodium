# Authority snapshot distribution

The authority database is metadata-only. Its public artifacts are:

- `import.sql`: deterministic D1 import. When the uncompressed file exceeds
  Wrangler's 300 MiB `r2 object put` limit, the R2 object is `import.sql.gz`
  plus `import.sql.gz.sha256`; `import.sql.sha256` and `checksum.txt` still
  hash the uncompressed SQL.
- `manifest.json`: schema, snapshot timestamp, and per-family row counts
- `import.sql.sha256`: uncompressed content checksum
- `licenses.json`: source URL, license, attribution, and fetched timestamp for
  every data family

Publish the checksummed bundle to R2:

```bash
npm run authority:publish:r2 -- \
  --directory exports/authority/<snapshot> \
  --bucket theallodium-authority-dumps \
  --prefix <snapshot> \
  --yes
```

The Zenodo record is deliberately metadata-only. The large SQL artifact
remains in R2; Zenodo receives the manifest, licenses, and checksum and points
readers to the bulk distribution:

```bash
# Dry run
npm run authority:publish:zenodo -- --directory exports/authority/<snapshot>

# Creates and publishes an immutable record/DOI
ZENODO_TOKEN=... npm run authority:publish:zenodo -- \
  --directory exports/authority/<snapshot> --yes
```

Publishing a Zenodo deposition is irreversible. The script therefore requires
both `ZENODO_TOKEN` and `--yes`; it does not read or upload the SQL dump.

Retraction Watch requires CC BY 4.0 attribution. ROR, OpenAlex, and DOAJ are
CC0 at the metadata layer used here. NLM Catalog journal data is included
under [NLM data terms](https://www.nlm.nih.gov/databases/download/terms_and_conditions.html):
redistribution is allowed with the required attribution
“Courtesy of the U.S. National Library of Medicine”, no implication of NLM
endorsement, and a conspicuous notice that this dated snapshot does not
reflect the most current NLM data. `licenses.json` carries those terms with
every snapshot and is not optional.
