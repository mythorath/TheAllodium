import { config } from "./load-env";
import { requireEnv, run } from "./cli";

config();

function main() {
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  console.log("Applying schema to remote staging D1…");
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "staging",
    "--remote",
    "--file",
    "./migrations/0001_schema.sql",
    "--yes",
  ]);

  console.log("Loading fixture…");
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "staging",
    "--remote",
    "--file",
    "./fixtures/spike_fixture.sql",
    "--yes",
  ]);

  console.log("Rebuilding FTS5…");
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

  console.log("Staging migration complete");
}

main();
