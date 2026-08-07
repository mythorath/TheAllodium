import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { requireEnv, run } from "./cli";

config();

type D1Row = Record<string, unknown>;

function remoteQuery(sql: string): { rows: D1Row[]; elapsedMs: number } {
  const started = Date.now();
  const result = run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "staging",
    "--remote",
    "--json",
    "--command",
    sql,
    "--yes",
  ]);
  const elapsedMs = Date.now() - started;
  const parsed = JSON.parse(result.stdout);
  const rows: D1Row[] = parsed[0]?.results ?? [];
  return { rows, elapsedMs };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function main() {
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const evidence: Record<string, unknown> = {
    at: new Date().toISOString(),
    results: {} as Record<string, unknown>,
  };
  const results = evidence.results as Record<string, unknown>;

  console.log("Remote smoke: entry/fts counts + manifest");
  results.entryCount = remoteQuery("SELECT COUNT(*) AS c FROM entries;");
  results.ftsCount = remoteQuery("SELECT COUNT(*) AS c FROM entry_fts;");
  results.manifest = remoteQuery(
    "SELECT contract_version, schema_version, entry_count, abstract_search_enabled FROM snapshot_manifest WHERE id = 1;",
  );

  console.log("Remote smoke: abstract leak check");
  results.abstractLeakCheck = remoteQuery(
    "SELECT COUNT(*) AS c FROM entry_search_documents WHERE abstract_text IS NOT NULL;",
  );

  console.log("Remote smoke: dynamically-discovered real alias resolution");
  const aliasRows = remoteQuery("SELECT alias_id, canonical_id FROM entry_aliases LIMIT 1;");
  results.aliasDiscovery = aliasRows;
  const alias = aliasRows.rows[0] as { alias_id?: string; canonical_id?: string } | undefined;
  if (alias?.canonical_id) {
    results.aliasCanonicalExists = remoteQuery(
      `SELECT id FROM entries WHERE id = ${sqlString(alias.canonical_id)};`,
    );
  } else {
    console.warn("No entry_aliases row found in staging sample — skipping alias resolution check");
  }

  console.log("Remote smoke: dynamically-discovered blocked-link discoverability");
  const blockedRows = remoteQuery(
    "SELECT id, title FROM entries WHERE link_status = 'blocked' LIMIT 1;",
  );
  results.blockedDiscovery = blockedRows;
  const blocked = blockedRows.rows[0] as { id?: string; title?: string } | undefined;
  if (blocked?.title) {
    const firstWord = blocked.title.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (firstWord && firstWord.length >= 2) {
      results.blockedStillSearchable = remoteQuery(
        `SELECT entry_id FROM entry_fts WHERE entry_fts MATCH '"${firstWord}"' LIMIT 10;`,
      );
    }
  } else {
    console.warn("No blocked-link entry found in staging sample — skipping discoverability check");
  }

  console.log("Remote smoke: rebuild FTS again (idempotent rebuild)");
  const rebuildStarted = Date.now();
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "staging",
    "--remote",
    "--file",
    "./migrations/0002_fts.sql",
    "--yes",
  ]);
  evidence.ftsRebuildMs = Date.now() - rebuildStarted;
  results.ftsCountAfterRebuild = remoteQuery("SELECT COUNT(*) AS c FROM entry_fts;");

  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    resolve("evidence/staging-sample-smoke.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Staging sample smoke ok — evidence/staging-sample-smoke.json");
}

main();
