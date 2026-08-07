import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./cli";

function d1Query(sql: string): string {
  const result = run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--json",
    "--command",
    sql,
  ]);
  return result.stdout;
}

function main() {
  console.log("Local smoke: reset + migrate + fixture");
  run("npm", ["run", "db:reset:local"]);

  const started = Date.now();
  const countJson = d1Query("SELECT COUNT(*) AS c FROM entries;");
  const ftsJson = d1Query("SELECT COUNT(*) AS c FROM entry_fts;");
  const valuesJson = d1Query(
    `SELECT entry_id FROM entry_fts WHERE entry_fts MATCH '"values"' LIMIT 5;`,
  );
  const likeJson = d1Query(
    `SELECT e.id FROM entry_search_documents d JOIN entries e ON e.id = d.entry_id WHERE lower(d.title) LIKE '%defusion%' OR lower(d.meta) LIKE '%defusion%' LIMIT 5;`,
  );
  const elapsedMs = Date.now() - started;

  const evidenceDir = resolve("evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    at: new Date().toISOString(),
    elapsedMs,
    entryCount: countJson,
    ftsCount: ftsJson,
    valuesMatch: valuesJson,
    likeDefusion: likeJson,
  };
  writeFileSync(
    resolve(evidenceDir, "local-smoke.json"),
    JSON.stringify(evidence, null, 2),
  );

  console.log(`Local smoke ok in ${elapsedMs}ms`);
  console.log("Evidence written to evidence/local-smoke.json");
}

main();
