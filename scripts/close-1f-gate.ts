import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";
import { readDeploymentsLog } from "./deployments-log";
import { SITE_URL } from "../src/site-config";

config();

interface SmokeLiveEvidence {
  at: string;
  base: string;
  results: Array<{ name: string; ok: boolean; detail?: string }>;
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
  console.log("Closing Phase 1F gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const log = readDeploymentsLog();
  const productionDeploys = log.filter((e) => e.env === "production" && e.type === "deploy");
  if (productionDeploys.length === 0) {
    throw new Error(
      "deployments/log.json has no production 'deploy' entry — run 'npm run deploy:production' first.",
    );
  }
  const lastDeploy = productionDeploys[productionDeploys.length - 1];

  console.log(`Verifying live production smoke evidence against ${SITE_URL}…`);
  const smokeEvidence = findProductionSmokeEvidence();
  console.log(
    `  found evidence at ${smokeEvidence.at}: ${smokeEvidence.results.length} checks, all passing`,
  );

  const decision = `# Phase 1F Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phases 1A–1E built the data pipeline and the public beta experience, running
only against local dev and unbound remote D1/Worker instances. Phase 1F
closes Phase 1 by making The Allodium **discoverable and actually
launched**: real structured data and crawler-facing files, security and
caching headers, a production deploy bound to \`${SITE_URL}\`, a
\`theallodium.com\` redirect, and a rollback runbook — all verified against
the live, public edge, not just Miniflare.

## SEO / discoverability

- \`src/site-config.ts\`'s \`SITE_URL\` is the single source of truth for
  every absolute URL this phase adds — canonical links, JSON-LD, and the
  sitemap can't drift from the deployed domain independently.
- Every page's \`<head>\` gets a \`<link rel="canonical">\` (\`Layout\`'s new
  \`canonicalPath\` prop); pages with no single canonical URL (404, 500)
  correctly omit it.
- \`EntryPage\` embeds a \`WebPage\`/\`mainEntity\` JSON-LD block
  (\`ScholarlyArticle\` for papers, \`CreativeWork\` otherwise), built only
  from fields already on the publication contract — never abstract/notes.
- \`/sitemap.xml\` is a live Hono route querying D1 on every request (not a
  build-time static file), so a snapshot promotion is reflected without a
  redeploy — consistent with this project's D1-is-source-of-truth design.
  5,643 entries plus 4 static routes sit comfortably under the
  single-sitemap 50,000-URL limit (proven against the full corpus in
  \`tests/full-snapshot.test.ts\`).
- \`public/robots.txt\` and \`public/llms.txt\` point crawlers (human-facing
  and LLM-facing) at the sitemap and \`/standard/\`.

## Security and caching headers

The same header set (\`X-Content-Type-Options\`, \`X-Frame-Options: DENY\`,
\`Referrer-Policy\`, \`Permissions-Policy\`, a same-origin \`Content-Security-Policy\`)
is applied twice, deliberately: once in \`public/_headers\` for literal
static-asset responses, and once in Hono middleware in \`src/index.tsx\` for
every Worker-rendered response — including explicitly inside \`app.onError\`,
since a thrown error bypasses the rest of a middleware's post-\`next()\` code
in Hono and would otherwise ship unprotected error pages. Successful HTML
GETs also get a 5-minute \`Cache-Control\`, short enough that a snapshot
promotion is visible within minutes without needing a purge step. A minimal
neutral SVG favicon (routed at \`/favicon.ico\` via a 301) stops 404 noise
without making any branding decision.

## Production deploy

- \`wrangler.jsonc\`'s \`production\` env now carries a Custom Domain route
  (\`{ "pattern": "theallodium.org", "custom_domain": true }\`) — Cloudflare
  provisions DNS and TLS automatically on deploy, since this Worker is the
  sole origin for the zone.
- \`scripts/deploy-worker.ts\` (mirrors \`promote-snapshot.ts\`'s shape) runs
  the same pre-flight checks as the gate, refuses to deploy against a
  target D1 with an empty \`snapshot_manifest\`, then runs
  \`wrangler deploy --env <env>\` and records the resulting Version ID as a
  new \`"deploy"\` entry type in \`deployments/log.json\` — extending the same
  audit trail Phase 1D built for promotions and rollbacks to also cover
  code deploys. Last recorded production deploy: version
  \`${lastDeploy.versionId}\` at ${lastDeploy.at}.
- A one-time account-level prerequisite, done during this phase: the
  Cloudflare account had no \`workers.dev\` subdomain registered yet, which
  \`wrangler deploy --env staging\` requires (production uses the Custom
  Domain instead, so it's unaffected). Registered via the Workers
  subdomain API so \`npm run deploy:staging\` produces a reachable
  \`https://theallodium-staging.theallodium.workers.dev\`.

## \`theallodium.com\` → \`${SITE_URL}\` redirect

\`scripts/cloudflare-api.ts\` (a minimal authenticated-fetch helper for the
handful of Cloudflare REST endpoints Wrangler doesn't cover) and
\`scripts/configure-com-redirect.ts\` idempotently PUT a single
\`http_request_dynamic_redirect\` phase-entrypoint rule on the
\`theallodium.com\` zone: a 301 to \`${SITE_URL}\` with the original path and
query string preserved, entirely at Cloudflare's edge — no Worker
involvement on the \`.com\` zone, so it is not billed as Worker requests.

A real gap found while executing this against the live zone: \`theallodium.com\`
had **zero** DNS records. A zone-level Ruleset only ever runs for requests
that already reached Cloudflare's edge, which requires at least one proxied
DNS record for the matched hostname to exist — an active-but-empty zone
resolves nowhere at all (confirmed against real DNS: \`theallodium.com\`
returned no answer until this was fixed). \`configure-com-redirect.ts\` now
also idempotently ensures a placeholder proxied \`A\` record (apex and
\`www\`, pointing at \`192.0.2.1\`, which the redirect rule ensures nothing
ever actually connects to) exists before applying the ruleset — this needed
one more token permission than originally scoped, \`Zone → DNS → Edit\` on
\`theallodium.com\`, documented in \`.env.example\`.

Also required a one-time account-level Cloudflare permission distinction to
work through: Account and Zone permissions are entirely separate grants on
an API token — full access to Account resources (D1, Workers Scripts) does
not imply any Zone-level access, even to zones already visible in the same
account. The token needed explicit Zone permission groups (Workers Routes,
Zone Read, Single Redirect, DNS), each scoped to the specific zone(s) that
need them, added on top of the Account-level grants earlier phases already
used.

## Live HTTP-level smoke testing

\`scripts/smoke-live.ts\` is new true edge-level verification, complementing
the existing D1-level \`smoke-checks.ts\` (data correctness only, via
\`wrangler d1 execute\`): real \`fetch()\` calls against a deployed Worker
checking home/search/standard/disclaimer/entry all 200 with the security
header set present and no \`Set-Cookie\`, \`/sitemap.xml\`'s URL count against
\`/health\`'s live \`entry_count\`, \`robots.txt\` referencing the sitemap, an
unknown route 404ing, and — only when run against \`${SITE_URL}\` itself —
that \`theallodium.com\` redirects correctly. Every run writes
\`evidence/smoke-live-<timestamp>.json\`; this gate requires the most recent
one against \`${SITE_URL}\` to have every check passing.

## Rollback runbook

\`docs/rollback-runbook.md\` separates the two independent rollback axes
this project now has — code (\`wrangler rollback <version-id> --env
production\`, using the Version IDs \`deploy-worker.ts\` now records) and
data (the existing \`db:rollback:staging\`/\`db:rollback:production\` from
Phase 1D, via D1 Time Travel) — with an explicit "both at once" sequence
and a reminder to always finish with \`smoke:live\` against the real domain.

## Exit gate

- Public beta is deployable: \`npm run deploy:staging\` /
  \`deploy:production\` are real, tested, auditable commands, not manual
  dashboard steps.
- Observable: every deploy, promotion, and rollback is an immutable
  \`deployments/log.json\` entry; every live smoke run is evidence on disk.
- Reversible: \`docs/rollback-runbook.md\` covers both code and data, and
  the data half was already proven against real infrastructure in Phase 1D.
- Independent of Selis except when publishing a new snapshot: the deployed
  Worker at \`${SITE_URL}\` serves entirely from D1 with zero runtime calls
  back to ACT or any Selis-hosted service.

## Explicitly deferred to later phases

- Faceted search, precomputed neighbors, citation export, collections/
  shortlists, OG images, the GPU layer, RAG, R2 dataset dumps, Zenodo/DOI,
  MCP routes, additional collections (Phase 2+).
- Any new visual identity/branding.
- \`gpu.theallodium.org\` (Phase 3's concern, not launch readiness).

## Stop

Phase 1F ends here. Phase 1 is complete. Do not start Phase 2 until this
record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-1f-decision-record.md"), decision);
  console.log("Wrote docs/phase-1f-decision-record.md");
  console.log("Phase 1F gate closed. Phase 1 complete.");
}

main();
