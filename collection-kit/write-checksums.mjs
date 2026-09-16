#!/usr/bin/env node
/**
 * Writes manifest.json and checksum.txt for a collection bundle.
 *
 *   node write-checksums.mjs <dir>
 *
 * The row-set checksum cannot be computed by hand, so run this after every
 * edit to import.sql and before `node validate.mjs <dir>`. If import.sql
 * still contains the literal PLACEHOLDER_CHECKSUM, it is replaced with the
 * computed value first, because snapshot_manifest.checksum lives inside the
 * SQL that the transport checksum then covers.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeRowSetChecksum, parseSnapshotTables, sha256 } from "./snapshot-sql.mjs";

const root = resolve(process.argv[2] ?? ".");
for (const name of ["collection.json", "import.sql"]) {
  if (!existsSync(join(root, name))) {
    console.error(`Missing ${name} in ${root}`);
    process.exit(1);
  }
}

const collection = JSON.parse(readFileSync(join(root, "collection.json"), "utf8"));
const sqlPath = join(root, "import.sql");
let sql = readFileSync(sqlPath, "utf8");

const rowChecksum = computeRowSetChecksum(sql);
if (sql.includes("PLACEHOLDER_CHECKSUM")) {
  sql = sql.replaceAll("PLACEHOLDER_CHECKSUM", rowChecksum);
  writeFileSync(sqlPath, sql);
}

function sourceGeneratedAt(insert) {
  if (!insert) return null;
  const index = insert.columns.indexOf("source_generated_at");
  if (index === -1) return null;
  const value = insert.rows[0]?.[index];
  return typeof value === "string" ? value : null;
}

const tables = parseSnapshotTables(sql);
const manifestRow = tables.inserts.find((item) => item.table === "snapshot_manifest");
const generatedAt = sourceGeneratedAt(manifestRow) ?? new Date().toISOString();

const linkStatus = {};
const resourceTypes = {};
for (const entry of tables.entries) {
  const status = String(entry.link_status ?? "unchecked");
  const type = String(entry.resource_type ?? "unknown");
  linkStatus[status] = (linkStatus[status] ?? 0) + 1;
  resourceTypes[type] = (resourceTypes[type] ?? 0) + 1;
}
const verifications = {};
for (const row of tables.verifications) {
  const kind = String(row.check_kind);
  const result = String(row.result);
  verifications[kind] = verifications[kind] ?? {};
  verifications[kind][result] = (verifications[kind][result] ?? 0) + 1;
}
const identifiers = {
  doi: tables.entries.filter((entry) => entry.doi).length,
  pmid: tables.entries.filter((entry) => entry.pmid).length,
  pmcid: tables.entries.filter((entry) => entry.pmcid).length,
};

const manifest = {
  contract_version: "2",
  schema_version: "1",
  collection: collection.slug,
  source_generated_at: generatedAt,
  entry_count: tables.entries.length,
  tag_link_count: tables.entry_tags.length,
  alias_count: tables.aliases.length,
  checksum: rowChecksum,
  abstract_search_enabled: false,
  exclusion_counts_json: {},
  coverage_json: {
    total_entries: tables.entries.length,
    verifications,
    link_status: linkStatus,
    identifiers,
    resource_types: resourceTypes,
  },
};

writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(root, "checksum.txt"), `${sha256(sql)}\n`);

console.log(`Wrote manifest.json and checksum.txt for ${collection.slug}`);
console.log(`  entries      ${tables.entries.length}`);
console.log(`  row-set      ${rowChecksum}`);
console.log(`  import.sql   ${sha256(sql)}`);
