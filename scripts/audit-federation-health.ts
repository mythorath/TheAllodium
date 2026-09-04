import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FEDERATION_ADAPTERS } from "../src/federation/adapters";
import type { AdapterStatus } from "../src/federation/types";

type HealthResult = {
  source: string;
  ok: boolean;
  status: number | null;
  latency_ms: number;
  error: string | null;
};

function statusError(status: AdapterStatus): string | null {
  switch (status.kind) {
    case "ok":
      return null;
    case "timeout":
      return `timeout after ${status.timeoutMs}ms`;
    case "http-error":
      return status.message;
    case "network-error":
      return status.message;
    case "invalid-response":
      return status.message;
    case "invalid-query":
      return status.message;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

async function main(): Promise<void> {
  const observations = await Promise.all(
    FEDERATION_ADAPTERS.map((adapter) =>
      adapter.search(
        { text: "climate adaptation", pageSize: 1 },
        { timeoutMs: 8_000, contactEmail: process.env.FEDERATION_CONTACT_EMAIL },
      ),
    ),
  );
  const results: HealthResult[] = observations.map((observation) => ({
    source: observation.source,
    ok: observation.status.kind === "ok",
    status:
      observation.status.kind === "ok" ||
      observation.status.kind === "http-error" ||
      observation.status.kind === "invalid-response"
        ? observation.status.httpStatus
        : null,
    latency_ms: observation.status.elapsedMs,
    error: statusError(observation.status),
  }));
  const evidence = {
    at: new Date().toISOString(),
    kind: "federation-health",
    results,
  };
  mkdirSync(resolve("evidence"), { recursive: true });
  const timestamp = evidence.at.replaceAll(":", "-");
  const path = resolve("evidence", `federation-health-${timestamp}.json`);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
  console.log(`Wrote ${path}`);
  if (results.every((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

await main();
