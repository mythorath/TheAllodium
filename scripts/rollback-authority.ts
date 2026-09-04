import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import {
  appendDeploymentsLog,
  authorityDatabaseNameFor,
  gitCommit,
  readDeploymentsLog,
  timeTravelBookmark,
  type DeploymentLogEntry,
} from "./deployments-log";

config();

function findPromotion(
  env: "staging" | "production",
  at: string | undefined,
): DeploymentLogEntry {
  const matches = readDeploymentsLog().filter(
    (entry) =>
      entry.type === "promote" &&
      entry.env === env &&
      entry.scope === "authority" &&
      (!at || entry.at === at),
  );
  const target = matches.at(-1);
  if (!target) throw new Error(`No authority promotion found for env=${env}.`);
  return target;
}

function main(): void {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") {
    throw new Error(
      "Usage: rollback-authority.ts --env staging|production --yes [--to <promotion timestamp>]",
    );
  }
  if (!booleans.has("yes")) {
    throw new Error("Refusing destructive authority rollback without --yes.");
  }
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  const target = findPromotion(env, flags.to);
  if (typeof target.preBookmark !== "string") {
    throw new Error(`Authority promotion ${target.at} has no pre-promotion bookmark.`);
  }
  run("npx", [
    "wrangler",
    "d1",
    "time-travel",
    "restore",
    "AUTHORITY",
    "--env",
    env,
    "--bookmark",
    target.preBookmark,
    "--json",
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
    "SELECT family, snapshot_id, row_count FROM authority_manifest ORDER BY family",
    "--json",
  ]);
  appendDeploymentsLog({
    type: "rollback",
    scope: "authority",
    at: new Date().toISOString(),
    env,
    databaseName: authorityDatabaseNameFor(env),
    restoredToBookmark: target.preBookmark,
    rolledBackPromotionAt: target.at,
    postBookmark: timeTravelBookmark(env, "AUTHORITY"),
    gitCommit: gitCommit(),
  });
  console.log(`Authority database ${env} rolled back before ${target.at}.`);
}

main();
