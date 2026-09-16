import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFlags } from "./cli";
import { validateCollectionBundle } from "../src/collections/validate-bundle";

function usage(): never {
  throw new Error(
    "Usage: validate-collection.ts --dir <path-to-unpacked-collection>\n" +
      "  Validates collection.json, import.sql, manifest.json, checksum.txt, and src/.",
  );
}

function main() {
  const { flags } = parseFlags(process.argv.slice(2));
  const dir = flags.dir;
  if (!dir) usage();
  const root = resolve(dir);
  const result = validateCollectionBundle(root);
  const evidence = {
    at: new Date().toISOString(),
    slug: result.slug,
    binding: result.binding,
    entryCount: result.entryCount,
    ok: true,
  };
  mkdirSync("evidence", { recursive: true });
  const evidencePath = resolve(`evidence/collection-validate-${result.slug}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Collection ${result.slug} validated (${result.entryCount} entries).`);
  console.log(`Wrote ${evidencePath}`);
}

main();
