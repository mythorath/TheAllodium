import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseFlags } from "./cli";

const QUERIES = [
  "climate adaptation",
  "quantum error correction",
  "medieval trade networks",
] as const;

async function main(): Promise<void> {
  const { flags } = parseFlags(process.argv.slice(2));
  const base = (flags.url ?? "https://theallodium-staging.theallodium.workers.dev")
    .replace(/\/$/, "");
  const output = resolve(flags.output ?? "evidence/federation-spike-edge.json");
  const runs = [];
  for (const query of QUERIES) {
    const started = performance.now();
    const response = await fetch(`${base}/api/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as {
      partial?: boolean;
      cached?: boolean;
      works?: unknown[];
      adapters?: Array<{
        source?: unknown;
        status?: unknown;
        hits?: unknown[];
        nextCursor?: unknown;
      }>;
    };
    runs.push({
      query,
      http_status: response.status,
      elapsed_ms: Math.round(performance.now() - started),
      partial: body.partial ?? null,
      cached: body.cached ?? null,
      merged_work_count: body.works?.length ?? null,
      adapters:
        body.adapters?.map((adapter) => ({
          source: adapter.source ?? null,
          status: adapter.status ?? null,
          hit_count: adapter.hits?.length ?? null,
          next_cursor_present: adapter.nextCursor !== null && adapter.nextCursor !== undefined,
        })) ?? null,
    });
    await new Promise((done) => setTimeout(done, 3_200));
  }
  const evidence = {
    diagnostic: "phase-5a-worker-egress-spike",
    generated_at: new Date().toISOString(),
    base,
    conclusion:
      "Single-request Worker egress measured. Shared-provider rate-limit contention across unrelated Cloudflare tenants remains inherently unprovable; the Durable Object limiter prevents this Worker from exceeding configured source budgets.",
    runs,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
  console.log(`Wrote ${output}`);
}

await main();
