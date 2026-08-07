import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";

config();

function main() {
  console.log("Closing Phase 1E gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const decision = `# Phase 1E Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phases 1A–1D built the data pipeline: schema, search, a real representative
sample, and a deterministic full-snapshot promotion/rollback pipeline. Phase
1E turns that into a **public beta experience** — a real \`/standard/\`
methodology page backed by live coverage numbers, legally consistent
crisis/disclaimer routing, accessible and responsive layout, honest
error/empty states, and an automated accessibility/route/search smoke suite
that a human reviewer can point to instead of eyeballing it.

## \`coverage_json\` reaches the application layer

Phase 1D stored \`coverage_json\` on \`snapshot_manifest\` but explicitly
deferred consuming it. This phase closes that loop: \`src/contract.ts\`'s
\`SnapshotManifest\` now types it as \`CoverageStats\`, and
\`getManifest()\` parses it. \`/standard/\` and the home page both render live
numbers straight from the deployed snapshot — never hardcoded, never a
separate query against a possibly-newer ACT database.

## New routes

- **\`/standard/\`** — the methodology page the roadmap calls "the
  differentiator." Explains the identity check (Crossref/OpenAlex DOI title
  match), legitimacy triage (confidence-thresholded screen defaulting to
  \`needs_review\` rather than silent inclusion), and link health gates
  (\`blocked\` vs \`ok\` vs \`unchecked\`, and why a dead link is removed
  entirely while a blocked one stays listed as inconclusive) — grounded in
  \`docs/publication-contract-v1.md\` and ACT's \`verify_identity.py\` /
  \`verify_legitimacy.py\`, not invented copy. Renders live coverage numbers,
  exclusion counts (what's excluded and why), limitations, and update
  cadence from the manifest.
- **\`/disclaimer\`** — crisis routing reusing the same legally-consistent
  copy already shipped on the sibling MythsMind site ("988" / Suicide &
  Crisis Lifeline, "text HOME to 741741" / Crisis Text Line,
  findahelpline.com for international lines), reframed for a published
  research index rather than an experiential art project. Linked from every
  page's footer, not buried.

## Accessibility, responsive layout, and error/empty states

- \`Layout\` gained a skip-to-content link, semantic \`<nav>\`/\`<footer>\`
  landmarks, and a persistent disclaimer/standard footer on every page.
- The search input has a real associated \`<label>\` (visually hidden, not
  just \`aria-label\`); the result-count line is \`aria-live="polite"\`.
- \`SearchPage\` now shows an explicit "No results for '{query}'" state
  instead of a silently empty list.
- \`app.onError\` renders a friendly \`ErrorPage\` (500) instead of an
  unhandled crash; \`NotFoundPage\` links back to search.
- \`public/styles.css\` adds focus-visible outlines, a mobile breakpoint for
  the nav/search form, and stronger badge contrast — no new visual identity
  or branding, which the roadmap explicitly puts *after* this phase's
  functional/legal/accessibility work.
- The stale "Phase 1A spike" home page copy is gone, replaced with a real
  value proposition and live entry/modality counts from the manifest.

## No-cookie / no-account, formalized

\`tests/repository.test.ts\` now asserts \`Set-Cookie\` is never present on
any route (home, standard, disclaimer, search, entry, 404) rather than
resting on prose alone.

## A real local-dev bug found and fixed

\`db:migrate:local\` (used by \`db:reset:local\`, the standard local-dev
setup path) hardcoded \`wrangler d1 execute --file\` calls for exactly
\`0001_schema.sql\` and \`0002_fts.sql\` — never updated when Phase 1D added
\`0003_coverage.sql\`. Local dev's D1 was silently missing the
\`coverage_json\` column, which made \`/standard/\` and \`/health\` both
500 locally the moment \`getManifest()\` started selecting it. Fixed by
switching to \`wrangler d1 migrations apply DB --local\` — the same tracked,
idempotent mechanism already used for staging/production in
\`promote-snapshot.ts\` — so a future \`0004\` migration can't silently go
missing from local dev again.

## New test infrastructure: Playwright + axe-core

1A–1D's test suite was entirely Workers-pool Vitest (Miniflare, no real
browser). The roadmap's exit gate explicitly requires "accessibility/route/
search smoke tests," which needs a real rendered page and an automated
auditor:

- \`playwright.config.ts\` runs the suite against the real Worker via
  \`npm run dev\` (the Cloudflare Vite plugin's Miniflare-backed dev server),
  reusing the same local D1 spike fixture the Vitest suite already knows.
- \`e2e/routes.spec.ts\` (12 tests) covers home, search (empty query, a
  known-result query, an explicit zero-result query, the labeled input),
  entries (canonical, alias redirect, missing-id 404), \`/standard/\`,
  \`/disclaimer\`, and the generic 404 — each with an \`@axe-core/playwright\`
  scan asserting zero serious/critical violations.
- \`npm run test:e2e\` wraps \`db:reset:local\` + \`playwright test\` so the
  suite always runs against known fixture state.
- Real multi-page pagination (Next/Previous) can't be exercised against the
  12-row local spike fixture — it never exceeds one page. Proven instead in
  \`tests/full-snapshot.test.ts\` against the real 5,643-row corpus, where a
  broad \`q=act\` query returns Previous/Next links on page 2 and different
  content across pages.

## Exit gate

- Representative users can find (search), assess (entry page verification
  records, \`/standard/\`'s methodology and coverage numbers), and follow an
  outbound resource — all provable locally, with Selis offline, against the
  synthetic fixture or the full snapshot.
- Accessibility, route, and search smoke tests pass: \`npm run test\`
  (Vitest) and \`npm run test:e2e\` (Playwright + axe-core) are both green.

## Explicitly deferred to later phases

- Faceted search, precomputed neighbors, citation export, collections/
  shortlists, OG images, the GPU layer, RAG, R2 dumps, Zenodo/DOI, MCP
  routes, sitemap/JSON-LD/robots.txt/llms.txt.
- Any new visual identity/branding for The Allodium.
- Deploying the Worker to a public domain (\`wrangler deploy\`, route
  binding, security headers) — Phase 1F.

## Stop

Phase 1E ends here. Do not start 1F until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-1e-decision-record.md"), decision);
  console.log("Wrote docs/phase-1e-decision-record.md");
  console.log("Phase 1E gate closed.");
}

main();
