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

  console.log("Resetting content tables (replacing any prior fixture/sample)…");
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "staging",
    "--remote",
    "--file",
    "./fixtures/reset_content_tables.sql",
    "--yes",
  ]);

  console.log("Loading Phase 1C representative real-data sample…");
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    "staging",
    "--remote",
    "--file",
    "./fixtures/staging_sample.sql",
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

  console.log("Staging sample load complete");
}

main();
