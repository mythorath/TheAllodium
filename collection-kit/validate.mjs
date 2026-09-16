#!/usr/bin/env node
/**
 * Dependency-free collection-bundle validator. Node 18+.
 *
 *   node validate.mjs <dir>
 *
 * The host's `npm run collection:validate` is authoritative; this copy
 * exists so an authoring agent can fail closed before handing the bundle
 * over. Run `node write-checksums.mjs <dir>` first.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  computeRowSetChecksum,
  parseSnapshotTables,
  rowsAsObjects,
  sha256,
} from "./snapshot-sql.mjs";

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
const RESERVED = new Set([
  "about",
  "api",
  "coverage",
  "disclaimer",
  "fields",
  "health",
  "issn",
  "keywords",
  "mcp",
  "og",
  "open-index",
  "organizations",
  "partials",
  "psychotherapy",
  "publishers",
  "retractions",
  "search",
  "sitemaps",
  "standard",
  "subjects",
  "venues",
  "works",
]);
const FORBIDDEN_ENTRY_FIELDS = new Set([
  "notes",
  "file_path",
  "extracted_text_path",
  "abstract",
  "abstract_text",
  "rationale",
  "license",
  "content_hash",
  "body",
  "therapy_modality",
]);
const ALLOWED_ENTRY_FIELDS = new Set([
  "id",
  "title",
  "resource_type",
  "source_org",
  "canonical_url",
  "author",
  "published_date",
  "credibility_tier",
  "is_link_only",
  "citation_count",
  "oa_status",
  "doi",
  "pmid",
  "pmcid",
  "link_status",
  "link_checked_at",
  "updated_at",
  "authors_json",
  "overview",
]);
const REQUIRED_ENTRY_FIELDS = ["id", "title", "resource_type", "canonical_url", "link_status"];
const ALLOWED_IMPORTS = new Set(["hono/jsx", "hono/jsx/jsx-runtime", "@allodium/collection"]);
const BANNED = [
  { re: /\bc\.env\b/, message: "must not read c.env" },
  { re: /\bprocess\.env\b/, message: "must not read process.env" },
  { re: /\beval\s*\(/, message: "must not call eval" },
  { re: /\bnew\s+Function\s*\(/, message: "must not construct Function" },
  { re: /\bimport\s*\(/, message: "must not use dynamic import()" },
  { re: /\bfetch\s*\(/, message: "must not call fetch" },
  { re: /\bWebSocket\b/, message: "must not use WebSocket" },
  { re: /\bfrom\s+['"]hono['"]/, message: "must not import the full hono package" },
  { re: /\bfrom\s+['"]node:/, message: "must not import node: modules" },
  { re: /\bfrom\s+['"]fs['"]/, message: "must not import fs" },
  { re: /\bGPU_SHARED_SECRET\b/, message: "must not mention GPU_SHARED_SECRET" },
];
const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s+|export\s+[\s\S]*?\s+from\s+)['"]([^'"]+)['"]/g;
const ABSOLUTE_PATH_RE =
  /(?:href|action|canonicalPath)\s*=\s*['"`](\/[^'"`\s]+)['"`]|location:\s*['"`](\/[^'"`\s]+)['"`]/g;
const FORBIDDEN_PATH_MARKERS = ["/tank/", "/home/", "acbs-member-personal-use"];
const SOURCE_CEILING = 512_000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const root = resolve(process.argv[2] ?? ".");
for (const name of ["collection.json", "import.sql", "manifest.json", "checksum.txt", "src"]) {
  if (!existsSync(join(root, name))) fail(`Missing ${name}`);
}

const collection = JSON.parse(readFileSync(join(root, "collection.json"), "utf8"));
if (collection.moduleContract !== "1") fail('collection.json moduleContract must be "1"');
if (typeof collection.slug !== "string" || !SLUG_PATTERN.test(collection.slug)) {
  fail(`Invalid slug ${collection.slug}`);
}
if (RESERVED.has(collection.slug)) fail(`Slug ${collection.slug} is reserved by the host`);
if (!["index", "atom", "orbit"].includes(collection.icon)) fail("icon must be index, atom, or orbit");
if (typeof collection.label !== "string" || collection.label.length < 1 || collection.label.length > 80) {
  fail("label must be 1-80 characters");
}
if (typeof collection.lede !== "string" || collection.lede.length < 1 || collection.lede.length > 280) {
  fail("lede must be 1-280 characters");
}
if (!Array.isArray(collection.facetCategories) || collection.facetCategories.length < 1) {
  fail("facetCategories must be a non-empty array");
}

const sqlBytes = readFileSync(join(root, "import.sql"));
const sql = sqlBytes.toString("utf8");
const transport = readFileSync(join(root, "checksum.txt"), "utf8").trim();
if (sha256(sqlBytes) !== transport) {
  fail("checksum.txt does not match SHA-256 of import.sql — run write-checksums.mjs");
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (manifest.collection !== collection.slug) fail("manifest.collection must match collection.json slug");
if (manifest.contract_version !== "2") fail("manifest.contract_version must be 2");
if (manifest.schema_version !== "1") fail("manifest.schema_version must be 1");

const tables = parseSnapshotTables(sql);
const manifestInserts = tables.inserts.filter((item) => item.table === "snapshot_manifest");
if (manifestInserts.length === 0) fail("No INSERT INTO snapshot_manifest");
for (const insert of manifestInserts) {
  for (const row of rowsAsObjects(insert)) {
    if (String(row.contract_version) !== "2") fail("snapshot_manifest.contract_version must be 2");
    if (String(row.schema_version) !== "1") fail("snapshot_manifest.schema_version must be 1");
    if (String(row.collection) !== collection.slug) {
      fail("snapshot_manifest.collection must match the slug");
    }
  }
}

const entriesInserts = tables.inserts.filter((item) => item.table === "entries");
if (entriesInserts.length === 0) fail("No INSERT INTO entries");
for (const insert of entriesInserts) {
  for (const column of insert.columns) {
    if (FORBIDDEN_ENTRY_FIELDS.has(column)) fail(`Forbidden entries column: ${column}`);
    if (!ALLOWED_ENTRY_FIELDS.has(column)) fail(`Unknown entries column: ${column}`);
  }
  for (const required of REQUIRED_ENTRY_FIELDS) {
    if (!insert.columns.includes(required)) fail(`entries INSERT missing required column: ${required}`);
  }
  for (const row of rowsAsObjects(insert)) {
    for (const value of Object.values(row)) {
      if (typeof value === "string") {
        for (const marker of FORBIDDEN_PATH_MARKERS) {
          if (value.includes(marker)) fail(`Forbidden substring ${marker} in an entries value`);
        }
      }
    }
  }
}

const entryIds = new Set(tables.entries.map((row) => String(row.id)));
if (entryIds.size !== tables.entries.length) fail("Duplicate entry ids");
const tagIds = new Set(tables.tags.map((row) => String(row.id)));
const allowedCategories = new Set(collection.facetCategories);
for (const tag of tables.tags) {
  if (!allowedCategories.has(String(tag.category))) {
    fail(`Tag category "${tag.category}" is not declared in facetCategories`);
  }
}
for (const row of tables.entry_tags) {
  if (!entryIds.has(String(row.entry_id))) fail(`entry_tags references missing entry ${row.entry_id}`);
  if (!tagIds.has(String(row.tag_id))) fail(`entry_tags references missing tag ${row.tag_id}`);
}
for (const row of tables.verifications) {
  if (!entryIds.has(String(row.entry_id))) fail(`verification references missing entry ${row.entry_id}`);
}
for (const row of tables.aliases) {
  if (!entryIds.has(String(row.canonical_id))) fail(`alias references missing entry ${row.canonical_id}`);
}
for (const row of tables.search_documents) {
  if (!entryIds.has(String(row.entry_id))) fail(`search document references missing entry ${row.entry_id}`);
}
for (const row of tables.neighbors) {
  if (!entryIds.has(String(row.entry_id)) || !entryIds.has(String(row.neighbor_id))) {
    fail("neighbor references a missing entry");
  }
}

const rowChecksum = computeRowSetChecksum(sql);
if (manifest.checksum !== rowChecksum) {
  fail(`manifest.checksum ${manifest.checksum} does not match row-set checksum ${rowChecksum}`);
}
if (manifest.entry_count !== tables.entries.length) fail("manifest.entry_count mismatch");
if (manifest.tag_link_count !== tables.entry_tags.length) fail("manifest.tag_link_count mismatch");
if (manifest.alias_count !== tables.aliases.length) fail("manifest.alias_count mismatch");

const srcRoot = join(root, "src");
const sourceFiles = walk(srcRoot).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
if (sourceFiles.length === 0) fail("src/ has no .ts or .tsx files");
const entryFile = sourceFiles.find((path) => /(?:^|\/)index\.tsx$/.test(path.replace(/\\/g, "/")));
if (!entryFile) fail("src/index.tsx is missing");

const bytes = sourceFiles.reduce((sum, path) => sum + readFileSync(path, "utf8").length, 0);
if (bytes > SOURCE_CEILING) fail(`Source is ${bytes} bytes; the ceiling is ${SOURCE_CEILING}`);

const findings = [];
for (const path of sourceFiles) {
  const source = readFileSync(path, "utf8");
  const rel = relative(srcRoot, path);
  if (path === entryFile) {
    if (!/\bdefineCollection\s*\(/.test(source) || !/\bexport\s+default\b/.test(source)) {
      findings.push(`${rel}: must export default defineCollection(...)`);
    }
  }
  for (const banned of BANNED) {
    if (banned.re.test(source)) findings.push(`${rel}: ${banned.message}`);
  }
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const spec = match[1];
    if (ALLOWED_IMPORTS.has(spec)) continue;
    if (spec.startsWith("./") || spec.startsWith("../")) {
      if (!isInside(srcRoot, resolve(path, "..", spec))) {
        findings.push(`${rel}: import escapes src/: ${spec}`);
      }
      continue;
    }
    findings.push(`${rel}: import is not on the allowlist: ${spec}`);
  }
  ABSOLUTE_PATH_RE.lastIndex = 0;
  let pathMatch;
  while ((pathMatch = ABSOLUTE_PATH_RE.exec(source)) !== null) {
    const abs = pathMatch[1] ?? pathMatch[2];
    if (!abs) continue;
    if (abs === `/${collection.slug}` || abs.startsWith(`/${collection.slug}/`)) continue;
    findings.push(`${rel}: absolute path ${abs} is not under /${collection.slug}/`);
  }
}
if (findings.length) {
  fail(`Static analysis failed:\n${findings.map((line) => `  ${line}`).join("\n")}`);
}

console.log(`ok ${collection.slug} (${tables.entries.length} entries)`);
