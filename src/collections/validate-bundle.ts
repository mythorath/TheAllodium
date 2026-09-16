import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseCollectionJson, derivedBinding, type CollectionJson } from "./collection-json";
import {
  MODULE_CONTRACT_VERSION,
  MODULE_SCHEMA_VERSION,
} from "./contract-v2";
import {
  analyzeCollectionSource,
  COLLECTION_SOURCE_BYTE_CEILING,
} from "./static-analysis";
import {
  assertSnapshotReferentialIntegrity,
  assertV2SnapshotSql,
  computeRowSetChecksum,
  parseSnapshotTables,
  sha256Bytes,
} from "./sql";

export type CollectionBundleLayout = {
  root: string;
  collectionJson: CollectionJson;
  sql: string;
  sqlBytes: Uint8Array;
  manifest: {
    contract_version: string;
    schema_version: string;
    collection: string;
    checksum: string;
    entry_count: number;
    tag_link_count: number;
    alias_count: number;
  };
  transportChecksum: string;
  sourceFiles: Array<{ path: string; source: string }>;
};

function walkFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walkFiles(path, files);
    else files.push(path);
  }
  return files;
}

export function loadCollectionBundle(root: string): CollectionBundleLayout {
  const collectionPath = join(root, "collection.json");
  const sqlPath = join(root, "import.sql");
  const manifestPath = join(root, "manifest.json");
  const checksumPath = join(root, "checksum.txt");
  for (const path of [collectionPath, sqlPath, manifestPath, checksumPath]) {
    if (!existsSync(path)) {
      throw new Error(`Collection bundle missing ${relative(root, path) || path}`);
    }
  }
  const collectionJson = parseCollectionJson(
    JSON.parse(readFileSync(collectionPath, "utf8")),
  );
  const sqlBytes = readFileSync(sqlPath);
  const sql = sqlBytes.toString("utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CollectionBundleLayout["manifest"];
  const transportChecksum = readFileSync(checksumPath, "utf8").trim();
  const srcRoot = join(root, "src");
  if (!existsSync(srcRoot)) {
    throw new Error("Collection bundle missing src/");
  }
  const sourceFiles = walkFiles(srcRoot)
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
  if (sourceFiles.length === 0) {
    throw new Error("Collection bundle src/ has no .ts/.tsx files");
  }
  const entry = sourceFiles.find((file) => /(?:^|\/)index\.tsx$/.test(file.path.replace(/\\/g, "/")));
  if (!entry) {
    throw new Error("Collection bundle missing src/index.tsx");
  }
  if (!/\bdefineCollection\s*\(/.test(entry.source) || !/\bexport\s+default\b/.test(entry.source)) {
    throw new Error("src/index.tsx must export default defineCollection(...)");
  }
  return {
    root,
    collectionJson,
    sql,
    sqlBytes,
    manifest,
    transportChecksum,
    sourceFiles,
  };
}

export function validateCollectionBundle(root: string): {
  slug: string;
  binding: string;
  entryCount: number;
  findings: string[];
} {
  const bundle = loadCollectionBundle(root);
  const findings: string[] = [];
  const { collectionJson, sql, sqlBytes, manifest, transportChecksum, sourceFiles } =
    bundle;

  if (sha256Bytes(sqlBytes) !== transportChecksum) {
    throw new Error("checksum.txt does not match SHA-256 of import.sql");
  }
  if (manifest.collection !== collectionJson.slug) {
    throw new Error("manifest.collection must match collection.json slug");
  }
  if (manifest.contract_version !== MODULE_CONTRACT_VERSION) {
    throw new Error(`manifest.contract_version must be ${MODULE_CONTRACT_VERSION}`);
  }
  if (manifest.schema_version !== MODULE_SCHEMA_VERSION) {
    throw new Error(`manifest.schema_version must be ${MODULE_SCHEMA_VERSION}`);
  }
  assertV2SnapshotSql(sql);
  assertSnapshotReferentialIntegrity(sql);
  const tables = parseSnapshotTables(sql);
  const allowedCategories = new Set(collectionJson.facetCategories);
  for (const tag of tables.tags) {
    const category = String(tag.category);
    if (!allowedCategories.has(category)) {
      throw new Error(
        `Tag category "${category}" is not declared in collection.json facetCategories`,
      );
    }
  }
  const rowChecksum = computeRowSetChecksum(sql);
  if (manifest.checksum !== rowChecksum) {
    throw new Error(
      `manifest.checksum ${manifest.checksum} does not match row-set checksum ${rowChecksum}`,
    );
  }
  if (manifest.entry_count !== tables.entries.length) {
    throw new Error(
      `manifest.entry_count ${manifest.entry_count} does not match ${tables.entries.length} entries`,
    );
  }
  if (manifest.tag_link_count !== tables.entry_tags.length) {
    throw new Error(
      `manifest.tag_link_count ${manifest.tag_link_count} does not match ${tables.entry_tags.length} links`,
    );
  }
  if (manifest.alias_count !== tables.aliases.length) {
    throw new Error(
      `manifest.alias_count ${manifest.alias_count} does not match ${tables.aliases.length} aliases`,
    );
  }

  const sourceBytes = sourceFiles.reduce((sum, file) => sum + file.source.length, 0);
  if (sourceBytes > COLLECTION_SOURCE_BYTE_CEILING) {
    throw new Error(
      `Collection source is ${sourceBytes} bytes; ceiling is ${COLLECTION_SOURCE_BYTE_CEILING}`,
    );
  }
  for (const finding of analyzeCollectionSource(
    sourceFiles,
    join(root, "src"),
    collectionJson.slug,
  )) {
    findings.push(`${finding.file}: ${finding.message}`);
  }
  if (findings.length > 0) {
    throw new Error(`Static analysis failed:\n${findings.map((line) => `  ${line}`).join("\n")}`);
  }

  return {
    slug: collectionJson.slug,
    binding: derivedBinding(collectionJson.slug),
    entryCount: manifest.entry_count,
    findings,
  };
}
