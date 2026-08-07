import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import { runSmokeChecks } from "./smoke-checks";
import { appendDeploymentsLog, databaseNameFor, gitCommit, timeTravelBookmark } from "./deployments-log";

config();

interface SnapshotManifest {
  entry_count: number;
  tag_link_count: number;
  alias_count: number;
  checksum: string;
  source_generated_at: string;
}

function usage(): never {
  throw new Error(
    "Usage: promote-snapshot.ts --env staging|production [--snapshot <fixture-name>] [--yes]\n" +
      "  --snapshot defaults to 'full_snapshot' (fixtures/full_snapshot.sql/.manifest.json/.checksum.txt)\n" +
      "  --yes is required when --env production (this replaces all live content)",
  );
}

function main() {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") usage();
  if (env === "production" && !booleans.has("yes")) {
    throw new Error(
      "Refusing to promote to production without --yes — this replaces all live content in theallodium-psychotherapy-production.",
    );
  }

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const snapshotName = flags.snapshot ?? "full_snapshot";
  const sqlPath = resolve(`fixtures/${snapshotName}.sql`);
  const manifestPath = resolve(`fixtures/${snapshotName}.manifest.json`);
  const checksumPath = resolve(`fixtures/${snapshotName}.checksum.txt`);
  for (const path of [sqlPath, manifestPath, checksumPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing snapshot artifact: ${path}`);
    }
  }

  console.log(`Verifying artifact integrity for fixtures/${snapshotName}.*…`);
  const sqlBytes = readFileSync(sqlPath);
  const expectedChecksum = readFileSync(checksumPath, "utf8").trim();
  const actualChecksum = createHash("sha256").update(sqlBytes).digest("hex");
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch for ${sqlPath}: file hashes to ${actualChecksum}, but checksum.txt says ${expectedChecksum}. ` +
        "Refusing to promote a possibly-corrupted artifact.",
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  console.log(
    `Promoting ${manifest.entry_count} entries / ${manifest.tag_link_count} tag links / ` +
      `${manifest.alias_count} aliases (source: ${manifest.source_generated_at}) to env=${env}`,
  );

  console.log(`Applying tracked migrations to env=${env} (idempotent; only unapplied files run)…`);
  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--env", env, "--remote"]);

  console.log(`Capturing pre-promotion Time Travel bookmark for env=${env}…`);
  const preBookmark = timeTravelBookmark(env);
  console.log(`  pre-promotion bookmark: ${preBookmark}`);

  console.log("Building one atomic promotion file (reset + import.sql + FTS rebuild)…");
  const resetSql = readFileSync(resolve("fixtures/reset_content_tables.sql"), "utf8");
  const importSql = readFileSync(sqlPath, "utf8");
  const ftsSql = readFileSync(resolve("migrations/0002_fts.sql"), "utf8");
  const combinedPath = resolve(`.promote-${env}-${Date.now()}.sql`);
  writeFileSync(combinedPath, [resetSql, importSql, ftsSql].join("\n\n"));

  try {
    console.log(
      `Executing exactly one 'wrangler d1 execute --file' against env=${env} — D1 wraps the entire file ` +
        "in one implicit transaction, so any failure mid-file rolls back and the prior content is untouched.",
    );
    run("npx", [
      "wrangler",
      "d1",
      "execute",
      "DB",
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

  console.log(`Running post-promotion smoke checks against env=${env}…`);
  const smoke = runSmokeChecks(env);
  mkdirSync("evidence", { recursive: true });
  const evidencePath = `evidence/promote-${env}-${Date.now()}.json`;
  writeFileSync(resolve(evidencePath), JSON.stringify(smoke, null, 2));
  console.log(`  wrote ${evidencePath}`);

  console.log(`Capturing post-promotion Time Travel bookmark for env=${env}…`);
  const postBookmark = timeTravelBookmark(env);

  appendDeploymentsLog({
    type: "promote",
    at: new Date().toISOString(),
    env,
    databaseName: databaseNameFor(env),
    snapshot: snapshotName,
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

  console.log(`Promotion to env=${env} complete.`);
  console.log(`  Pre-promotion bookmark (for rollback): ${preBookmark}`);
  console.log(`  Recorded in deployments/log.json`);
}

main();
