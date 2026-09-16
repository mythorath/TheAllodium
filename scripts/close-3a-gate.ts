import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";

config();

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

interface GpuHealthEvidence {
  http_status?: number;
  elapsed_s?: number;
  body?: { status?: string; ollama?: boolean; model?: string | null };
}

interface GpuFailClosedEvidence {
  http_status?: number;
  service?: string;
}

function main() {
  console.log("Closing Phase 3A gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const health = readJson(resolve("evidence/gpu-health.json")) as GpuHealthEvidence | null;
  const failClosed = readJson(resolve("evidence/gpu-fail-closed.json")) as GpuFailClosedEvidence | null;

  if (!health || health.http_status !== 200 || health.body?.status !== "ok") {
    throw new Error(
      "Missing or failing evidence/gpu-health.json, curl https://gpu.theallodium.org/api/health must return 200 {status:ok} and be recorded first",
    );
  }
  if (!failClosed || failClosed.http_status === 200 || failClosed.service !== "stopped") {
    throw new Error(
      "Missing or failing evidence/gpu-fail-closed.json, stop allodium-gpu-api, curl the public hostname, record a non-200, then restart",
    );
  }

  const decision = `# Phase 3A Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phase 3A is the GPU-bridge spike: an optional path from the Worker to Selis
that is absent-as-\`false\`, never an exception. No search UI, no \`?ask=\`,
no LLM generation. The live origin is \`gpu.theallodium.org\` on the existing
\`mythsmind-backend\` Cloudflare Tunnel; the Worker helper is \`pingGpu()\`
with a 500ms timeout.

No Worker deploy this phase. \`CONTRACT_VERSION\` is unchanged. CSP is
unchanged (\`default-src 'self'\`: the browser never calls the GPU origin).

## Token scope

\`CLOUDFLARE_API_TOKEN\` needed two additions beyond Phase 1F, documented
in \`.env.example\` and README:

- Zone → DNS → Edit on \`theallodium.org\` (CNAME)
- Account → Cloudflare Tunnel → Edit (ingress PUT)

GET of the tunnel configuration and of \`.org\` DNS records already
succeeded with the existing token before the PUT. The configure script's
PUT and CNAME create also succeeded, so both Edit scopes are in place.

## GPU service

\`allodium-gpu-api.service\` binds \`127.0.0.1:8421\` only, \`Restart=always\`,
\`Wants=ollama.service\`. \`GET /api/health\` probes Ollama \`/api/tags\`
(3s timeout) and does **not** load a chat model. HTTP 200 even when Ollama
is down (\`status: "degraded"\`) so a dead origin is distinguishable from a
dead tunnel.

Preferred model: \`qwen2.5:7b-instruct-q6_k\` (already kept warm-ish by
MythsMind Leaves; same 3080 Ti). Contention with Leaves is best-effort on
both sides, extra fallbacks, not failures.

## Tunnel merge safety

Tunnel \`mythsmind-backend\` (\`b86db5e6-210e-4b3c-9b08-7359b9f7318e\`),
\`config_src: cloudflare\`. \`configure-gpu-tunnel-route.ts\` GET-merge-PUTs
ingress and refuses to PUT if \`api.mythsmind.com\` would drop or the
catch-all would not be last. Resulting ingress:

1. \`api.mythsmind.com\` → \`http://localhost:8420\`
2. \`gpu.theallodium.org\` → \`http://localhost:8421\`
3. catch-all \`http_status:404\`

Proxied CNAME: \`gpu.theallodium.org\` →
\`b86db5e6-210e-4b3c-9b08-7359b9f7318e.cfargotunnel.com\`.

## Live proof

Public health (hairpin through Cloudflare's edge):

\`\`\`json
${JSON.stringify(health, null, 2)}
\`\`\`

After \`systemctl stop allodium-gpu-api\` the same URL failed closed
(non-200, not a hang):

\`\`\`json
${JSON.stringify(failClosed, null, 2)}
\`\`\`

Service was restarted and public health returned 200 again.

## Worker helper

\`src/gpu.ts\` \`pingGpu(env)\` returns \`false\` when \`GPU_ORIGIN\` is
unset/blank, on non-OK HTTP, on network throw, and on abort, and never
throws. Timeout is 500ms. \`GPU_ORIGIN\` is a wrangler \`vars\` value on
staging and production only; local/tests leave it unset so the suite never
hits the live GPU. No route calls \`pingGpu\` yet.

## 3B blocker (do not skip)

Health is unauthenticated so later \`smoke:gpu\` can hit it without a
secret. **Phase 3B must put a shared secret on \`POST /api/nl-query\`
before that endpoint exists.** The public hostname is otherwise an open
GPU.

## Exit gate

- \`npm run secrets:scan\`, \`typecheck\`, \`test\` (Vitest, Workers runtime)
  pass, including \`tests/gpu.test.ts\`.
- \`npm run test:e2e\` (Playwright + axe-core) passes with zero
  serious/critical accessibility violations, existing suite, no new UI.
- Live evidence: public health 200 + fail-closed after stop.
- Neither staging nor production Worker was deployed this phase.

## Explicitly deferred

- \`POST /api/nl-query\`, \`?ask=\`, crisis short-circuit, facet
  normalization (3B).
- Cloudflare Rate Limiting, \`smoke:gpu\` cron, \`/standard\` AI
  disclosure, \`docs/gpu-runbook.md\` (3C).
- Worker deploy to staging/production.
- A new tunnel, Cloudflare Access, or CSP \`connect-src\` change.
- Grounded RAG answers with citations.

## Stop

Phase 3A ends here. Do not start 3B until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-3a-decision-record.md"), decision);
  console.log("Wrote docs/phase-3a-decision-record.md");
  console.log("Phase 3A gate closed.");
}

main();
