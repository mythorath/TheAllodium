import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FEDERATION_ADAPTERS } from "../src/federation/adapters";
import type {
  AdapterResult,
  AdapterStatus,
  FederationQuery,
} from "../src/federation/types";

// arXiv's legacy API is the strictest implemented source: one request every
// three seconds across all controlled machines, with one connection at a time.
const MINIMUM_INTER_QUERY_DELAY_MS = 3_200;

const QUERIES: readonly FederationQuery[] = [
  { text: "\"acceptance and commitment therapy\"", pageSize: 5 },
  { text: "\"psychological flexibility\" review", pageSize: 5 },
  { text: "\"values clarification\" psychotherapy", pageSize: 5 },
];

function outputPath(args: readonly string[]): string | null {
  const index = args.indexOf("--output");
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Usage: spike-federation.ts [--output <path>]");
  }
  return resolve(value);
}

function statusKind(status: AdapterStatus): AdapterStatus["kind"] {
  switch (status.kind) {
    case "ok":
    case "timeout":
    case "http-error":
    case "network-error":
    case "invalid-response":
    case "invalid-query":
      return status.kind;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function observation(result: AdapterResult) {
  return {
    source: result.source,
    status: statusKind(result.status),
    latencyMs: result.status.elapsedMs,
    hitCount: result.hits.length,
    nextCursorPresent: result.nextCursor !== null,
    detail: result.status,
  };
}

async function main(): Promise<void> {
  const destination = outputPath(process.argv.slice(2));
  const runs: Array<{
    query: FederationQuery;
    observations: ReturnType<typeof observation>[];
  }> = [];

  for (const query of QUERIES) {
    const results = await Promise.all(
      FEDERATION_ADAPTERS.map((adapter) =>
        adapter.search(query, {
          timeoutMs: 8_000,
          contactEmail: process.env.FEDERATION_CONTACT_EMAIL,
        }),
      ),
    );
    runs.push({ query, observations: results.map(observation) });
    // The next wave starts only after every adapter has settled plus this
    // delay, so each source receives requests farther apart than 3.2 seconds.
    if (query !== QUERIES[QUERIES.length - 1]) {
      await delay(MINIMUM_INTER_QUERY_DELAY_MS);
    }
  }

  const report = {
    diagnostic: "phase-5a-federation-spike",
    generatedAt: new Date().toISOString(),
    productionSafeToSchedule: false,
    adapterSources: FEDERATION_ADAPTERS.map((adapter) => adapter.source),
    minimumInterQueryDelayMs: MINIMUM_INTER_QUERY_DELAY_MS,
    politenessNote:
      "One request wave at a time; arXiv calls are separated by at least 3.2 seconds.",
    queries: runs,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(json);
  if (destination) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, json, "utf8");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
