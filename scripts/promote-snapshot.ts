import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import { runSmokeChecks, type SmokeSchema } from "./smoke-checks";
import { appendDeploymentsLog, databaseNameFor, gitCommit, timeTravelBookmark } from "./deployments-log";
import { diffSnapshotLinks } from "./diff-snapshot-links";
import { collectionBindingName } from "../src/collections/contract-v2";

config();

interface SnapshotManifest {
  entry_count: number;
  tag_link_count: number;
  alias_count: number;
  checksum: string;
  source_generated_at: string;
  collection?: string;
}

function usage(): never {
  throw new Error(
    "Usage: promote-snapshot.ts --env staging|production [--snapshot <fixture-name>] [--snapshot-dir <dir>] [--binding DB] [--yes] [--acknowledge-link-changes]\n" +
      "  --snapshot defaults to 'full_snapshot' (fixtures/full_snapshot.sql/.manifest.json/.checksum.txt)\n" +
      "  --snapshot-dir loads import.sql, manifest.json, and checksum.txt from a collection bundle\n" +
      "  --binding defaults to DB, or COLLECTION_<SLUG> when --snapshot-dir is set\n" +
      "  --yes is required when --env production (this replaces all live content)",
  );
}

function main() {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") usage();
  if (env === "production" && !booleans.has("yes")) {
    throw new Error(
      "Refusing to promote to production without --yes. This replaces all live content.",
    );
  }
  if (flags.snapshot && flags["snapshot-dir"]) {
    throw new Error("Pass either --snapshot or --snapshot-dir, not both");
  }

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const snapshotDir = flags["snapshot-dir"] ? resolve(flags["snapshot-dir"]) : null;
  const snapshotName = snapshotDir
    ? flags.snapshot ?? "collection"
    : flags.snapshot ?? "full_snapshot";
  const schema: SmokeSchema = snapshotDir ? "collection-v2" : "psychotherapy";
  const sqlPath = snapshotDir
    ? resolve(snapshotDir, "import.sql")
    : resolve(`fixtures/${snapshotName}.sql`);
  const manifestPath = snapshotDir
    ? resolve(snapshotDir, "manifest.json")
    : resolve(`fixtures/${snapshotName}.manifest.json`);
  const checksumPath = snapshotDir
    ? resolve(snapshotDir, "checksum.txt")
    : resolve(`fixtures/${snapshotName}.checksum.txt`);
  for (const path of [sqlPath, manifestPath, checksumPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing snapshot artifact: ${path}`);
    }
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  const binding =
    flags.binding ??
    (snapshotDir && manifest.collection
      ? collectionBindingName(manifest.collection)
      : "DB");
  // Recorded in the deployment log only. Wrangler reads the real
  // migrations_dir from this binding's entry in wrangler.jsonc.
  const migrationsDir =
    schema === "collection-v2" ? "collection-migrations" : "migrations";
  const ftsFile =
    schema === "collection-v2"
      ? "collection-migrations/0002_fts.sql"
      : "migrations/0002_fts.sql";
  const resetFile = "fixtures/reset_content_tables.sql";
  const databaseName =
    binding === "DB"
      ? databaseNameFor(env)
      : `theallodium-${manifest.collection ?? snapshotName}-${env}`;

  console.log(`Verifying artifact integrity for ${sqlPath}…`);
  const sqlBytes = readFileSync(sqlPath);
  const expectedChecksum = readFileSync(checksumPath, "utf8").trim();
  const actualChecksum = createHash("sha256").update(sqlBytes).digest("hex");
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch for ${sqlPath}: file hashes to ${actualChecksum}, but checksum.txt says ${expectedChecksum}. ` +
        "Refusing to promote a possibly-corrupted artifact.",
    );
  }

  console.log(
    `Promoting ${manifest.entry_count} entries / ${manifest.tag_link_count} tag links / ` +
      `${manifest.alias_count} aliases (source: ${manifest.source_generated_at}) to env=${env} binding=${binding}`,
  );

  console.log(`Diffing new snapshot links against currently-live entries in env=${env} binding=${binding}…`);
  diffSnapshotLinks(env, snapshotName, {
    acknowledge: booleans.has("acknowledge-link-changes"),
    binding,
    sqlPath,
  });

  console.log(`Applying tracked migrations to env=${env} binding=${binding} (idempotent; only unapplied files run)…`);
  run("npx", [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    binding,
    "--env",
    env,
    "--remote",
  ]);

  console.log(`Capturing pre-promotion Time Travel bookmark for env=${env} binding=${binding}…`);
  const preBookmark = timeTravelBookmark(env, binding);
  console.log(`  pre-promotion bookmark: ${preBookmark}`);

  console.log("Building one atomic promotion file (reset + import.sql + FTS rebuild)…");
  const resetSql = readFileSync(resolve(resetFile), "utf8");
  const importSql = readFileSync(sqlPath, "utf8");
  const ftsSql = readFileSync(resolve(ftsFile), "utf8");
  const combinedPath = resolve(`.promote-${env}-${Date.now()}.sql`);
  writeFileSync(combinedPath, [resetSql, importSql, ftsSql].join("\n\n"));

  try {
    console.log(
      `Executing exactly one 'wrangler d1 execute --file' against env=${env} binding=${binding}: D1 wraps the entire file ` +
        "in one implicit transaction, so any failure mid-file rolls back and the prior content is untouched.",
    );
    run("npx", [
      "wrangler",
      "d1",
      "execute",
      binding,
      "--env",
      env,
      "--remote",
      "--file",
      combinedPath,
      "--yes",
    ]);
  } finally {
    rmSync(combinedPath, { force: true });
  }

  console.log(`Running post-promotion smoke checks against env=${env} binding=${binding}…`);
  const smoke = runSmokeChecks(env, { binding, schema, ftsFile: `./${ftsFile}` });
  mkdirSync("evidence", { recursive: true });
  const evidencePath = `evidence/promote-${env}-${Date.now()}.json`;
  writeFileSync(resolve(evidencePath), JSON.stringify(smoke, null, 2));
  console.log(`  wrote ${evidencePath}`);

  console.log(`Capturing post-promotion Time Travel bookmark for env=${env} binding=${binding}…`);
  const postBookmark = timeTravelBookmark(env, binding);

  appendDeploymentsLog({
    type: "promote",
    at: new Date().toISOString(),
    env,
    databaseName,
    binding,
    snapshot: snapshotName,
    snapshotDir: snapshotDir ?? undefined,
    migrationsDir,
    entryCount: manifest.entry_count,
    tagLinkCount: manifest.tag_link_count,
    aliasCount: manifest.alias_count,
    checksum: manifest.checksum,
    sourceGeneratedAt: manifest.source_generated_at,
    preBookmark,
    postBookmark,
    evidencePath,
    gitCommit: gitCommit(),
  });

  console.log(`Promotion to env=${env} binding=${binding} complete.`);
  console.log(`  Pre-promotion bookmark (for rollback): ${preBookmark}`);
  console.log(`  Recorded in deployments/log.json`);
}

main();
