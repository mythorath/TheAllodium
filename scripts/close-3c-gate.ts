import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";
import { SITE_URL } from "../src/site-config";

config();

interface SmokeLiveEvidence {
  at: string;
  base: string;
  results: Array<{ name: string; ok: boolean; detail?: string }>;
}

interface GpuSmokeEvidence {
  http_status?: number | null;
  ok?: boolean;
  body?: { status?: string };
}

interface AskRatelimitEvidence {
  rule_id?: string;
  expression?: string;
  requests_per_period?: number;
  period?: number;
  status_code?: number;
  entitlement_fallback?: boolean;
  requested_period?: number;
  fallback_label?: string;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function findProductionSmokeEvidence(): SmokeLiveEvidence {
  const dir = resolve("evidence");
  if (!existsSync(dir)) {
    throw new Error(
      `No evidence/ directory found — run 'npm run smoke:live -- --url ${SITE_URL}' against the live production Worker first.`,
    );
  }
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith("smoke-live-") && name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(resolve(dir, name), "utf8")) as SmokeLiveEvidence)
    .filter((evidence) => evidence.base === SITE_URL)
    .sort((a, b) => a.at.localeCompare(b.at));

  const latest = candidates[candidates.length - 1];
  if (!latest) {
    throw new Error(
      `No evidence/smoke-live-*.json found for base=${SITE_URL} — run 'npm run smoke:live -- --url ${SITE_URL}' first.`,
    );
  }
  const failed = latest.results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `Most recent production smoke-live evidence (${latest.at}) has ${failed.length} failing check(s): ` +
        failed.map((r) => r.name).join(", "),
    );
  }
  return latest;
}

function main() {
  console.log("Closing Phase 3C gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const ratelimit = readJson(resolve("evidence/ask-ratelimit.json")) as AskRatelimitEvidence | null;
  if (
    !ratelimit?.rule_id ||
    !ratelimit.expression?.includes("/psychotherapy/search") ||
    ratelimit.requests_per_period !== 20 ||
    (ratelimit.period !== 60 &&
      !(ratelimit.period === 10 && ratelimit.entitlement_fallback === true))
  ) {
    throw new Error(
      "Missing or incomplete evidence/ask-ratelimit.json — run 'npm run configure:ask-ratelimit' first (20 req / 60s on ?ask=, or entitled fallback with entitlement_fallback).",
    );
  }

  const gpuSmoke = readJson(resolve("evidence/gpu-smoke.json")) as GpuSmokeEvidence | null;
  if (!gpuSmoke || gpuSmoke.http_status !== 200 || gpuSmoke.ok !== true) {
    throw new Error(
      "Missing or failing evidence/gpu-smoke.json — run 'npm run smoke:gpu' (HTTP 200, status ok or degraded) first.",
    );
  }

  console.log(`Verifying live production smoke evidence against ${SITE_URL}…`);
  const smokeEvidence = findProductionSmokeEvidence();
  console.log(
    `  found evidence at ${smokeEvidence.at}: ${smokeEvidence.results.length} checks, all passing`,
  );

  const decision = `# Phase 3C Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phase 3C makes the Selis live layer safe to leave on unattended: a zone
rate-limit on visitor \`?ask=\` (before any Worker deploy), GPU health
smoke plus a non-fatal daily cron log, public disclosure on \`/standard\`,
and an operator runbook. Staging then production were deployed with
\`smoke:live\` and \`smoke:gpu\` after the rate-limit rule existed.

NL/crisis/normalize behavior is unchanged from 3B. \`CONTRACT_VERSION\` is
unchanged. CSP is unchanged. \`nl-query-rag\` stays **pending** — this
phase does not add grounded answers.

## Rate-limit \`?ask=\` (visitor IPs, not the GPU origin)

The rule is on \`theallodium.org\`, not \`gpu.theallodium.org\`. Worker
fetches to the tunnel share Cloudflare egress IPs; limiting the origin
would collapse every visitor into one bucket. \`POST /api/nl-query\` is
already bearer-gated.

\`scripts/configure-ask-ratelimit.ts\` GET-merge-PUTs the
\`http_ratelimit\` entrypoint so existing rules are not wiped. Idempotent
on description \`Phase 3C: cap ?ask= NL search per IP\`.
Cloudflare requires \`cf.colo.id\` alongside \`ip.src\` in
\`characteristics\`; counting is still per visitor IP.

- Rule id: \`${ratelimit.rule_id}\`
- Expression: \`${ratelimit.expression}\`
- Threshold: ${ratelimit.requests_per_period} requests / ${ratelimit.period}s / IP
  ${
    ratelimit.entitlement_fallback
      ? `(requested path+query \`ask=\` at ${ratelimit.requested_period ?? 60}s; this zone's WAF plan is not entitled to a 60s period or to \`http.request.uri.query\` — applied \`${ratelimit.fallback_label ?? "entitled fallback"}\`)`
      : ""
  }
- Action: block ${ratelimit.status_code ?? 429}

**429 is the abuse path.** It does **not** fall through to keyword search.
That degrade is for timeout / Selis-asleep / other origin failure only.

Staging \`*.workers.dev\` is outside this zone rule; that is accepted.

Token scope added: Zone → WAF → Edit on \`theallodium.org\`. Confirmed by
GET of the \`http_ratelimit\` entrypoint before PUT.

## Observability

- \`npm run smoke:gpu\` GETs \`https://gpu.theallodium.org/api/health\`
  (15s timeout), passes on HTTP 200 with JSON \`status\` of \`ok\` **or**
  \`degraded\`, writes \`evidence/gpu-smoke.json\`. Latest run:
  HTTP ${gpuSmoke.http_status}, status \`${gpuSmoke.body?.status ?? "?"}\`.
- \`scripts/cron-audit-links.sh\` still fails the job on a link-audit
  failure. GPU smoke after that is appended to
  \`evidence/cron-gpu-health.log\` and **must not** \`exit 1\` if Selis is
  asleep. Reinstall is not required; the next 08:00 run picks it up.

## Disclosure and runbook

\`/standard\` has an "Optional AI-assisted search" section after
Limitations and before Update cadence: optional; keyword/facet always
work; model \`qwen2.5:7b-instruct-q6_k\`; Worker sends only capped \`ask\`
text; re-validation drops unknown tokens; offline/timeout → keyword
results; not therapy; crisis-intent skips the model and shows 988.
\`docs/gpu-runbook.md\` is operator-only and is **not** linked from the
public page.

## Deploy

Rate-limit rule was live before Worker deploys. Staging then production
were deployed with \`GPU_SHARED_SECRET\` already present from 3B.
Production live smoke (\`${SITE_URL}\`) at ${smokeEvidence.at}:
${smokeEvidence.results.length} checks, all passing.

## Exit gate

- \`npm run secrets:scan\`, \`typecheck\`, \`test\`, \`test:e2e\` pass.
- Evidence: \`ask-ratelimit.json\`, \`gpu-smoke.json\` (200), production
  \`smoke-live-*.json\` for \`${SITE_URL}\`.
- \`nl-query-rag\` stays pending.

## Explicitly deferred

- Grounded RAG answers, Worker-side KV rate counting, Cloudflare Access,
  CSP \`connect-src\`
- Rate-limiting \`gpu.theallodium.org\` itself

## Stop

Phase 3C ends here. The optional NL search path is live and rate-limited.
Do not start grounded RAG until this record is accepted and real usage
exists.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-3c-decision-record.md"), decision);
  console.log("Wrote docs/phase-3c-decision-record.md");
  console.log("Phase 3C gate closed. nl-query-rag stays pending.");
}

main();
