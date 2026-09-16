import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { requireEnv, run } from "./cli";

config();

// Mirrors create-staging-d1.ts. Phase 1D creates this now so the full
// promote/rollback pipeline can be rehearsed against genuine Cloudflare
// infrastructure. The Worker itself is not deployed to any public domain
// against it until Phase 1F.
const STAGING_ENV_TAIL = `        }
      ]
    }
  }
}
`;

function main() {
  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  console.log("Creating remote production D1: theallodium-psychotherapy-production");
  const result = run("npx", [
    "wrangler",
    "d1",
    "create",
    "theallodium-psychotherapy-production",
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
  console.log(`Production database_id: ${databaseId}`);

  const wranglerPath = resolve("wrangler.jsonc");
  const text = readFileSync(wranglerPath, "utf8");
  let updated: string;

  if (text.includes("theallodium-psychotherapy-production")) {
    // Re-running: replace the existing production database_id in place.
    updated = text.replace(
      /("database_name": "theallodium-psychotherapy-production",\s*\n\s*(?:\/\/[^\n]*\n\s*)?"database_id": ")[^"]+(")/,
      `$1${databaseId}$2`,
    );
  } else {
    if (!text.endsWith(STAGING_ENV_TAIL)) {
      throw new Error(
        'wrangler.jsonc did not end with the expected "staging" env closing shape, ' +
          'insert the "production" env block by hand and re-run this script to just set the database_id.',
      );
    }
    const productionBlock = `        }
      ]
    },
    "production": {
      "name": "theallodium-production",
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "theallodium-psychotherapy-production",
          // Written by create-production-d1.ts after wrangler d1 create
          "database_id": "${databaseId}",
          "migrations_dir": "migrations"
        }
      ]
    }
  }
}
`;
    updated = text.slice(0, -STAGING_ENV_TAIL.length) + productionBlock;
  }

  writeFileSync(wranglerPath, updated);
  console.log('Updated wrangler.jsonc with the "production" env block');
}

main();
