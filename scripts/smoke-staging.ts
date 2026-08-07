import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { requireEnv, run } from "./cli";
import { runRemoteQueryRaw } from "./smoke-checks";

config();

// This spike (Phase 1A) tests fixed, known IDs/words from the tiny synthetic
// spike_fixture.sql, unlike smoke-checks.ts's dynamic discovery over real
// data -- only the low-level query runner is shared.
function remoteQuery(sql: string): { stdout: string; elapsedMs: number } {
  return runRemoteQueryRaw("staging", sql);
}

function main() {
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const queries: Record<string, string> = {
    entryCount: "SELECT COUNT(*) AS c FROM entries;",
    ftsCount: "SELECT COUNT(*) AS c FROM entry_fts;",
    manifest:
      "SELECT contract_version, schema_version, entry_count, abstract_search_enabled FROM snapshot_manifest WHERE id = 1;",
    valuesMatch:
      "SELECT entry_id FROM entry_fts WHERE entry_fts MATCH '\"values\"' LIMIT 5;",
    abstractLeakCheck:
      "SELECT COUNT(*) AS c FROM entry_fts WHERE entry_fts MATCH '\"evaluates\"';",
    likeDefusion:
      "SELECT e.id FROM entry_search_documents d JOIN entries e ON e.id = d.entry_id WHERE lower(d.title) LIKE '%defusion%' OR lower(d.meta) LIKE '%defusion%' LIMIT 5;",
    alias:
      "SELECT canonical_id FROM entry_aliases WHERE alias_id = 'retired000000001';",
  };

  const evidence: Record<string, unknown> = {
    at: new Date().toISOString(),
    results: {} as Record<string, unknown>,
  };

  for (const [name, sql] of Object.entries(queries)) {
    console.log(`Remote smoke: ${name}`);
    const { stdout, elapsedMs } = remoteQuery(sql);
    (evidence.results as Record<string, unknown>)[name] = {
      elapsedMs,
      stdout: JSON.parse(stdout),
    };
  }

  // Prove drop+recreate FTS path on remote (idempotent rebuild).
  console.log("Remote smoke: rebuild FTS again");
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

  const afterRebuild = remoteQuery("SELECT COUNT(*) AS c FROM entry_fts;");
  (evidence.results as Record<string, unknown>).ftsCountAfterRebuild = {
    elapsedMs: afterRebuild.elapsedMs,
    stdout: JSON.parse(afterRebuild.stdout),
  };

  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    resolve("evidence/staging-smoke.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Staging smoke ok — evidence/staging-smoke.json");
}

main();
