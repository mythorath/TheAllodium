import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import { runSmokeChecks } from "./smoke-checks";
import {
  appendDeploymentsLog,
  databaseNameFor,
  gitCommit,
  readDeploymentsLog,
  timeTravelBookmark,
  type DeploymentLogEntry,
} from "./deployments-log";

config();

function usage(): never {
  throw new Error(
    "Usage: rollback-snapshot.ts --env staging|production --yes [--to <ISO-timestamp-of-a-prior-promote-entry>]\n" +
      "  Defaults to undoing that env's most recent 'promote' entry in deployments/log.json.\n" +
      "  This is destructive and in-flight queries against the target database will be cancelled.",
  );
}

function findTargetPromotion(env: "staging" | "production", to: string | undefined): DeploymentLogEntry {
  const log = readDeploymentsLog();
  const promotions = log.filter((entry) => entry.env === env && entry.type === "promote");
  if (promotions.length === 0) {
    throw new Error(`No 'promote' entries found for env=${env} in deployments/log.json — nothing to roll back.`);
  }
  if (to) {
    const match = promotions.find((entry) => entry.at === to);
    if (!match) {
      throw new Error(
        `No promote entry for env=${env} at timestamp ${to}. Available timestamps: ${promotions
          .map((entry) => entry.at)
          .join(", ")}`,
      );
    }
    return match;
  }
  return promotions[promotions.length - 1];
}

function main() {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") usage();
  if (!booleans.has("yes")) {
    throw new Error(
      "Refusing to roll back without --yes — this destructively overwrites the target database's current content.",
    );
  }

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const target = findTargetPromotion(env, flags.to);
  const preBookmark = target.preBookmark as string | undefined;
  if (!preBookmark) {
    throw new Error(`Target promote entry (at=${target.at}) has no preBookmark recorded — cannot roll back to it.`);
  }

  console.log(
    `Rolling env=${env} back to the state immediately before the promotion at ${target.at} ` +
      `(snapshot=${target.snapshot}, entries=${target.entryCount}), bookmark=${preBookmark}`,
  );

  run("npx", [
    "wrangler",
    "d1",
    "time-travel",
    "restore",
    "DB",
    "--env",
    env,
    "--bookmark",
    preBookmark,
    "--json",
  ]);

  console.log(`Running post-rollback smoke checks against env=${env}…`);
  const smoke = runSmokeChecks(env);
  mkdirSync("evidence", { recursive: true });
  const evidencePath = `evidence/rollback-${env}-${Date.now()}.json`;
  writeFileSync(resolve(evidencePath), JSON.stringify(smoke, null, 2));
  console.log(`  wrote ${evidencePath}`);

  const postBookmark = timeTravelBookmark(env);

  appendDeploymentsLog({
    type: "rollback",
    at: new Date().toISOString(),
    env,
    databaseName: databaseNameFor(env),
    restoredToBookmark: preBookmark,
    rolledBackPromotionAt: target.at,
    postBookmark,
    evidencePath,
    gitCommit: gitCommit(),
  });

  console.log(`Rollback of env=${env} complete. Recorded in deployments/log.json.`);
}

main();
