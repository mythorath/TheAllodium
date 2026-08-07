import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { requireEnv, run } from "./cli";

config();

function main() {
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  console.log("Creating remote staging D1: theallodium-psychotherapy-staging");
  const result = run("npx", [
    "wrangler",
    "d1",
    "create",
    "theallodium-psychotherapy-staging",
  ]);

  const combined = `${result.stdout}\n${result.stderr}`;
  const match =
    combined.match(/database_id\s*=\s*"([^"]+)"/i) ||
    combined.match(/database_id["']?\s*:\s*["']([^"']+)["']/i) ||
    combined.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );

  if (!match) {
    console.error(combined);
    throw new Error("Could not parse database_id from wrangler d1 create output");
  }

  const databaseId = match[1];
  console.log(`Staging database_id: ${databaseId}`);

  const wranglerPath = resolve("wrangler.jsonc");
  let text = readFileSync(wranglerPath, "utf8");
  if (!text.includes("REPLACE_WITH_STAGING_D1_ID")) {
    // Also allow re-running: replace previous UUID under staging env only.
    text = text.replace(
      /("database_name": "theallodium-psychotherapy-staging",\s*"database_id": ")[^"]+(")/,
      `$1${databaseId}$2`,
    );
  } else {
    text = text.replace("REPLACE_WITH_STAGING_D1_ID", databaseId);
  }
  writeFileSync(wranglerPath, text);
  console.log("Updated wrangler.jsonc staging database_id");
}

main();
