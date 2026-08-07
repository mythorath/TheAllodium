import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { requireEnv } from "./cli";
import { runSmokeChecks } from "./smoke-checks";

config();

function main() {
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const evidence = runSmokeChecks("staging");

  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    resolve("evidence/staging-sample-smoke.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Staging sample smoke ok — evidence/staging-sample-smoke.json");
}

main();
