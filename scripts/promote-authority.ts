import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import {
  appendDeploymentsLog,
  authorityDatabaseNameFor,
  gitCommit,
  timeTravelBookmark,
} from "./deployments-log";

config();

type AuthorityManifest = {
  snapshot_id: string;
  snapshot_at: string;
  import_sha256: string;
  row_counts: Record<string, number>;
};

function main(): void {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") {
    throw new Error(
      "Usage: promote-authority.ts --env staging|production --directory <snapshot-dir> [--yes]",
    );
  }
  if (env === "production" && !booleans.has("yes")) {
    throw new Error("Refusing authority production promotion without --yes.");
  }
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  const directory = resolve(flags.directory ?? "exports/authority/latest");
  const importPath = resolve(directory, "import.sql");
  const manifestPath = resolve(directory, "manifest.json");
  const checksumPath = resolve(directory, "checksum.txt");
  for (const path of [importPath, manifestPath, checksumPath]) {
    if (!existsSync(path)) throw new Error(`Missing authority artifact: ${path}`);
  }
  const expected = readFileSync(checksumPath, "utf8").trim();
  const actual = createHash("sha256").update(readFileSync(importPath)).digest("hex");
  if (actual !== expected) {
    throw new Error(`Authority checksum mismatch: expected ${expected}, got ${actual}`);
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as AuthorityManifest;
  if (manifest.import_sha256 !== actual) {
    throw new Error("Authority manifest checksum does not match import.sql.");
  }

  run("npx", [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "AUTHORITY",
    "--env",
    env,
    "--remote",
  ]);
  const preBookmark = timeTravelBookmark(env, "AUTHORITY");
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "AUTHORITY",
    "--env",
    env,
    "--remote",
    "--file",
    importPath,
    "--yes",
  ]);
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "AUTHORITY",
    "--env",
    env,
    "--remote",
    "--command",
    "SELECT family, row_count FROM authority_manifest ORDER BY family",
    "--json",
  ]);
  const postBookmark = timeTravelBookmark(env, "AUTHORITY");
  appendDeploymentsLog({
    type: "promote",
    scope: "authority",
    at: new Date().toISOString(),
    env,
    databaseName: authorityDatabaseNameFor(env),
    snapshot: manifest.snapshot_id,
    sourceGeneratedAt: manifest.snapshot_at,
    rowCounts: manifest.row_counts,
    checksum: actual,
    preBookmark,
    postBookmark,
    gitCommit: gitCommit(),
  });
  console.log(`Authority snapshot ${manifest.snapshot_id} promoted to ${env}.`);
}

main();
