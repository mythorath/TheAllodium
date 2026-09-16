import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import { remoteQuery } from "./smoke-checks";
import { appendDeploymentsLog, databaseNameFor, gitCommit } from "./deployments-log";

config();

function usage(): never {
  throw new Error(
    "Usage: deploy-worker.ts --env staging|production [--yes]\n" +
      "  --yes is required when --env production (this makes the Worker code live).",
  );
}

/** Refuses to point a freshly deployed Worker at an empty database, code
 * and data go live together, so a deploy against a not-yet-promoted D1
 * would just serve null-manifest pages (or worse, look like data loss). */
function assertManifestNonEmpty(env: "staging" | "production"): void {
  console.log(`Verifying env=${env}'s D1 has a non-empty published snapshot…`);
  const result = remoteQuery(
    env,
    "SELECT entry_count FROM snapshot_manifest WHERE id = 1;",
  );
  const row = result.rows[0] as { entry_count?: number } | undefined;
  if (!row?.entry_count || row.entry_count <= 0) {
    throw new Error(
      `env=${env}'s snapshot_manifest is empty or missing (entry_count=${row?.entry_count ?? "none"}). ` +
        `Run 'npm run db:promote:${env}' (or db:load:staging-sample for staging) before deploying code.`,
    );
  }
  console.log(`  entry_count=${row.entry_count}, safe to deploy.`);
}

function main() {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const env = flags.env;
  if (env !== "staging" && env !== "production") usage();
  if (env === "production" && !booleans.has("yes")) {
    throw new Error(
      "Refusing to deploy to production without --yes. This makes the new Worker version live at theallodium.org.",
    );
  }

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  console.log("Running pre-deploy checks: secrets scan, typecheck, test…");
  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  assertManifestNonEmpty(env);

  console.log(`Deploying Worker code to env=${env}…`);
  const result = run("npx", ["wrangler", "deploy", "--env", env]);
  console.log(result.stdout);

  const versionMatch = result.stdout.match(/Current Version ID:\s*(\S+)/);
  const versionId = versionMatch?.[1] ?? "unknown";
  if (versionId === "unknown") {
    console.warn(
      "Could not parse a Version ID from wrangler's output, recording 'unknown'. " +
        "Check `wrangler deployments list --env " + env + "` if a rollback is ever needed.",
    );
  }

  appendDeploymentsLog({
    type: "deploy",
    at: new Date().toISOString(),
    env,
    databaseName: databaseNameFor(env),
    versionId,
    gitCommit: gitCommit(),
  });

  console.log(`Deploy to env=${env} complete. Version ID: ${versionId}`);
  console.log("Recorded in deployments/log.json");
}

main();
