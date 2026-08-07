import { run } from "./cli";

/** Shared remote D1 smoke-check queries, parameterized by wrangler env name
 * ("staging" | "production"), reused by smoke-staging.ts,
 * smoke-staging-sample.ts, promote-snapshot.ts, and rollback-snapshot.ts so
 * every caller verifies the same set of real-data invariants after touching
 * a remote database. */

export type D1Row = Record<string, unknown>;

export interface RemoteQueryResult {
  rows: D1Row[];
  elapsedMs: number;
}

/** Runs `wrangler d1 execute --json` and returns the raw stdout text
 * alongside timing, before any parsing/shape assumptions are applied. */
export function runRemoteQueryRaw(env: string, sql: string): { stdout: string; elapsedMs: number } {
  const started = Date.now();
  const result = run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    env,
    "--remote",
    "--json",
    "--command",
    sql,
    "--yes",
  ]);
  return { stdout: result.stdout, elapsedMs: Date.now() - started };
}

export function remoteQuery(env: string, sql: string): RemoteQueryResult {
  const { stdout, elapsedMs } = runRemoteQueryRaw(env, sql);
  const parsed = JSON.parse(stdout);
  const rows: D1Row[] = parsed[0]?.results ?? [];
  return { rows, elapsedMs };
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface SmokeEvidence {
  at: string;
  env: string;
  results: Record<string, unknown>;
  ftsRebuildMs?: number;
}

export function runSmokeChecks(env: string): SmokeEvidence {
  const evidence: SmokeEvidence = {
    at: new Date().toISOString(),
    env,
    results: {},
  };
  const results = evidence.results;

  console.log(`[${env}] smoke: entry/fts counts + manifest`);
  results.entryCount = remoteQuery(env, "SELECT COUNT(*) AS c FROM entries;");
  results.ftsCount = remoteQuery(env, "SELECT COUNT(*) AS c FROM entry_fts;");
  results.manifest = remoteQuery(
    env,
    "SELECT contract_version, schema_version, entry_count, abstract_search_enabled, coverage_json FROM snapshot_manifest WHERE id = 1;",
  );

  console.log(`[${env}] smoke: abstract leak check`);
  results.abstractLeakCheck = remoteQuery(
    env,
    "SELECT COUNT(*) AS c FROM entry_search_documents WHERE abstract_text IS NOT NULL;",
  );

  console.log(`[${env}] smoke: dynamically-discovered real alias resolution`);
  const aliasRows = remoteQuery(env, "SELECT alias_id, canonical_id FROM entry_aliases LIMIT 1;");
  results.aliasDiscovery = aliasRows;
  const alias = aliasRows.rows[0] as { alias_id?: string; canonical_id?: string } | undefined;
  if (alias?.canonical_id) {
    results.aliasCanonicalExists = remoteQuery(
      env,
      `SELECT id FROM entries WHERE id = ${sqlString(alias.canonical_id)};`,
    );
  } else {
    console.warn(`[${env}] No entry_aliases row found — skipping alias resolution check`);
  }

  console.log(`[${env}] smoke: dynamically-discovered blocked-link discoverability`);
  const blockedRows = remoteQuery(
    env,
    "SELECT id, title FROM entries WHERE link_status = 'blocked' LIMIT 1;",
  );
  results.blockedDiscovery = blockedRows;
  const blocked = blockedRows.rows[0] as { id?: string; title?: string } | undefined;
  if (blocked?.title) {
    const firstWord = blocked.title.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (firstWord && firstWord.length >= 2) {
      results.blockedStillSearchable = remoteQuery(
        env,
        `SELECT entry_id FROM entry_fts WHERE entry_fts MATCH '"${firstWord}"' LIMIT 10;`,
      );
    }
  } else {
    console.warn(`[${env}] No blocked-link entry found — skipping discoverability check`);
  }

  console.log(`[${env}] smoke: dynamically-discovered faceted browse combo (Phase 2B)`);
  const modalityRows = remoteQuery(
    env,
    "SELECT therapy_modality, COUNT(*) AS c FROM entries GROUP BY therapy_modality ORDER BY c DESC LIMIT 1;",
  );
  const topModality = (modalityRows.rows[0] as { therapy_modality?: string } | undefined)
    ?.therapy_modality;
  if (topModality) {
    results.facetModalityAudience = remoteQuery(
      env,
      `SELECT audience, COUNT(*) AS c FROM entries WHERE therapy_modality = ${sqlString(topModality)} GROUP BY audience;`,
    );
    results.facetAccessBucket = remoteQuery(
      env,
      `SELECT CASE WHEN oa_status = 'closed' THEN 'paywalled' ELSE 'free' END AS bucket, COUNT(*) AS c
       FROM entries WHERE therapy_modality = ${sqlString(topModality)} AND oa_status IS NOT NULL
       GROUP BY bucket;`,
    );
  } else {
    console.warn(`[${env}] No modality found — skipping faceted browse smoke check`);
  }

  console.log(`[${env}] smoke: rebuild FTS again (idempotent rebuild)`);
  const rebuildStarted = Date.now();
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    env,
    "--remote",
    "--file",
    "./migrations/0002_fts.sql",
    "--yes",
  ]);
  evidence.ftsRebuildMs = Date.now() - rebuildStarted;
  results.ftsCountAfterRebuild = remoteQuery(env, "SELECT COUNT(*) AS c FROM entry_fts;");

  return evidence;
}
