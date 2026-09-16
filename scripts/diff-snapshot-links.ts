import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";
import { remoteQuery } from "./smoke-checks";
import { parseEntryLinksFromSnapshotSql } from "./snapshot-sql";

config();

/**
 * Cross-snapshot stability check: an entry id is meant to be a permanent
 * handle (see docs/... or the plan this implements), so if a resource's
 * `canonical_url` or `title` silently changes under an id that's *already
 * live*, a bookmarked/shared link or a reader's memory of "that entry"
 * quietly starts pointing somewhere unexpected -- indistinguishable from a
 * bug unless it's surfaced explicitly. Legitimate cases exist (a re-crawl
 * picks up a corrected canonical link, a title gets fixed upstream), so this
 * doesn't forbid the change -- it just refuses to promote past it silently.
 */

function usage(): never {
  throw new Error(
    "Usage: diff-snapshot-links.ts --env staging|production [--snapshot <fixture-name>] [--sql <path>] [--binding DB] [--acknowledge]\n" +
      "  Compares the new snapshot SQL about to be promoted against the currently-live\n" +
      "  entries in --env (and --binding, default DB). For every id present in both, flags\n" +
      "  any changed title/canonical_url. Exits non-zero on any change unless --acknowledge\n" +
      "  is passed (evidence is written either way). A live database with zero entries\n" +
      "  (first-ever promotion) has nothing to diff against and passes.",
  );
}

export interface LinkChange {
  id: string;
  field: "title" | "canonical_url";
  before: string;
  after: string;
}

export interface DiffSnapshotLinksResult {
  overlap: number;
  changes: LinkChange[];
  evidencePath: string;
}

export type DiffSnapshotLinksOpts = {
  acknowledge?: boolean;
  binding?: string;
  sqlPath?: string;
};

export function diffSnapshotLinks(
  env: "staging" | "production",
  snapshotName: string,
  opts?: DiffSnapshotLinksOpts,
): DiffSnapshotLinksResult {
  const binding = opts?.binding ?? "DB";
  const sqlPath = resolve(opts?.sqlPath ?? `fixtures/${snapshotName}.sql`);
  const newLinks = parseEntryLinksFromSnapshotSql(readFileSync(sqlPath, "utf8"));
  console.log(`Parsed ${newLinks.size} entries from ${sqlPath}`);

  console.log(`Querying currently-live entries in env=${env} binding=${binding}…`);
  const liveCountRow = remoteQuery(env, "SELECT COUNT(*) AS c FROM entries;", binding);
  const liveCount = (liveCountRow.rows[0] as { c?: number } | undefined)?.c ?? 0;

  const changes: LinkChange[] = [];
  let overlap = 0;

  if (liveCount === 0) {
    console.log(`  env=${env} currently has no live entries (first promotion) — nothing to diff against.`);
  } else {
    const liveRows = remoteQuery(env, "SELECT id, title, canonical_url FROM entries;", binding);
    for (const row of liveRows.rows) {
      const r = row as { id: string; title: string; canonical_url: string };
      const next = newLinks.get(r.id);
      // Missing from the new snapshot just means this id was retired --
      // expected churn, not a "changed under a stable id" event.
      if (!next) continue;
      overlap += 1;
      if (next.title !== r.title) {
        changes.push({ id: r.id, field: "title", before: r.title, after: next.title });
      }
      if (next.canonical_url !== r.canonical_url) {
        changes.push({ id: r.id, field: "canonical_url", before: r.canonical_url, after: next.canonical_url });
      }
    }
    console.log(`  ${overlap} ids are present in both the live env and the new snapshot.`);
  }

  if (changes.length === 0) {
    console.log("No id kept its id but changed title/canonical_url — safe to promote.");
  } else {
    console.log(`\n${changes.length} field change(s) under a STABLE id — review before promoting:`);
    for (const change of changes) {
      console.log(`  [${change.field}] ${change.id}\n    was: ${change.before}\n    now: ${change.after}`);
    }
  }

  mkdirSync("evidence", { recursive: true });
  const evidencePath = resolve(`evidence/diff-snapshot-links-${env}-${Date.now()}.json`);
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        env,
        binding,
        snapshot: snapshotName,
        overlap,
        changes,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${evidencePath}`);

  if (changes.length > 0 && !opts?.acknowledge) {
    throw new Error(
      `${changes.length} entry link(s) would silently change under a stable id — review ${evidencePath}, ` +
        "then re-run with --acknowledge (or pass --acknowledge-link-changes to promote-snapshot.ts) once " +
        "you've confirmed these are intentional (e.g. a re-crawled canonical_url), not a data bug.",
    );
  }

  return { overlap, changes, evidencePath };
}

function main() {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") usage();
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  diffSnapshotLinks(env, flags.snapshot ?? "full_snapshot", {
    acknowledge: booleans.has("acknowledge"),
    binding: flags.binding,
    sqlPath: flags.sql,
  });
}

// Runs standalone (`npm run diff:links -- --env staging`) as well as being
// imported directly by promote-snapshot.ts -- only invoke main() when this
// file is the actual entry point, matching Node's documented ESM pattern.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
