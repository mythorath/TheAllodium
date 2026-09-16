import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";
import { readDeploymentsLog } from "./deployments-log";

config();

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

interface Phase2bManifest {
  checksum: string;
  entry_count: number;
}

interface PromoteLogEntry {
  type: string;
  env: string;
  checksum?: string;
  evidencePath?: string;
  at: string;
}

function main() {
  console.log("Closing Phase 2B gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const manifest = readJson(resolve("fixtures/full_snapshot.manifest.json")) as Phase2bManifest | null;
  if (!manifest) {
    throw new Error("Missing fixtures/full_snapshot.manifest.json: Phase 2B adds no new snapshot data, so this should already exist from 2A.");
  }

  console.log(
    "Re-promoting the current full snapshot to staging. Content is unchanged from 2A, but this " +
      "applies migrations/0005_facets.sql (idempotent: 'wrangler d1 migrations apply' only runs " +
      "unapplied files) and exercises the extended post-promotion smoke checks against real remote D1.",
  );
  run("npm", ["run", "db:promote:staging"]);

  const log = readDeploymentsLog() as PromoteLogEntry[];
  const stagingPromotes = log.filter((e) => e.env === "staging" && e.type === "promote");
  if (stagingPromotes.length === 0) {
    throw new Error("deployments/log.json has no staging promotion after running db:promote:staging, something went wrong.");
  }
  const lastPromote = stagingPromotes[stagingPromotes.length - 1];
  if (lastPromote.checksum !== manifest.checksum) {
    throw new Error(
      `Staging's most recent promotion (checksum ${lastPromote.checksum}) does not match the current ` +
        `fixtures/full_snapshot.manifest.json checksum (${manifest.checksum}).`,
    );
  }

  if (!lastPromote.evidencePath || !existsSync(resolve(lastPromote.evidencePath))) {
    throw new Error(`Missing promotion evidence file at ${lastPromote.evidencePath}`);
  }
  const evidence = readJson(resolve(lastPromote.evidencePath)) as {
    results?: Record<string, unknown>;
  };
  if (!evidence.results?.facetModalityAudience) {
    throw new Error(
      `${lastPromote.evidencePath} is missing the Phase 2B facetModalityAudience smoke check, ` +
        "scripts/smoke-checks.ts::runSmokeChecks() should have been extended before this gate.",
    );
  }

  const decision = `# Phase 2B Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phase 2A extended the publication contract to v1.1 (\`audience\`, \`authors_json\`,
\`entry_neighbors\`) but deferred actually querying most of those new fields.
Phase 2B turns \`/psychotherapy/search\` into a real faceted browse-and-search
experience: five filterable dimensions (modality, audience, free-vs-paywalled,
stored-vs-link-only, link status), each multi-select and fully URL-stated, plus
a first-class no-query browse mode, all still server-rendered, still no
accounts/cookies/JS required to use.

## Confirmed design decisions (see phase_2_roadmap.md and the approved plan)

- **Multi-select facets** via checkboxes in one GET form, not single-select
  links: URL uses repeated params (\`?modality=cbt&modality=dbt\`).
- **Cross-filtered counts**: each dimension's counts reflect every *other*
  active filter plus the text query, but never that dimension's own filter,
  so switching a selection within a dimension is always visible as an option,
  not just the values present in the already-filtered result set.
- **Access bucketing**: \`paywalled\` = \`oa_status = 'closed'\`; \`free\` = any
  other non-null \`oa_status\`; entries with a \`NULL\` \`oa_status\` (non-paper
  resources) are excluded from both buckets rather than forced into either.

## New module: \`src/db/facets.ts\`

Kept separate from \`src/db/repository.ts\` to keep the query-composition
surface (parsing, WHERE-building, cross-filtered counting) in one place while
\`repository.ts\` stays focused on orchestrating the fts/like/browse paths.
\`FacetFilters\`/\`buildFacetWhere\`/\`computeFacetCounts\`/\`parseFacetFilters\`
are all pure/DB-boundary functions with no route or view code: Phase 4's MCP
routes can reuse them unchanged, per the roadmap's later-phase compatibility
rule.

## \`repository.ts\`: unifying search, browse, and facets

\`searchEntries()\` gained a \`filters: FacetFilters\` parameter and a new
\`"browse"\` mode: no text query but at least one active filter is now a
first-class path (paginated \`entries\` scan ordered by title, no FTS/LIKE
join), not the old "enter a keyword" error state. The FTS and LIKE paths were
extended to AND a facet WHERE fragment into both their \`COUNT(*)\` and paged
\`SELECT\`. \`PAGE_SIZE\` was raised from 10 to 25.

A real implementation-time fix beyond the plan's literal text: the *truly*
empty landing state (no query, no filters) originally short-circuited before
computing any facet counts, which would have made the checkbox menu itself
invisible on first page load. Filters would only have been reachable by
already knowing the URL param names. Fixed by always computing facet counts
(against the current filters, ignoring an empty/rejected search term) even on
the "empty" path, so browsing is discoverable from a cold landing on
\`/psychotherapy/search\`, not just from a pre-built URL.

## View: checkbox fieldsets, not hardcoded facet-value labels

\`SearchPage\` renders one \`<fieldset>\`/\`<legend>\` per dimension from
whatever values \`computeFacetCounts()\` actually returns (data-driven, same
"no hardcoded enum" philosophy as \`/standard/\`'s coverage \`CountList\`),
modality, audience, and link status show their raw values; only the two
synthetic bucket dimensions (access, storage), whose values don't already
appear anywhere else in the UI, get a small inline label map
(\`ACCESS_LABELS\`/\`STORAGE_LABELS\`). Pager links and the "Clear filters" link
both derive from the same \`filterEntries()\` helper the checkboxes' \`checked\`
state uses, so they can't drift out of sync with what's actually selected.

## Schema: \`migrations/0005_facets.sql\`

Adds \`idx_entries_audience\` and \`idx_entries_is_link_only\`: the two facet
dimensions that didn't already have an index from \`0001_schema.sql\`
(\`therapy_modality\`, \`oa_status\`, and \`link_status\` were already indexed).

## Test coverage added

- \`tests/repository.test.ts\`: single- and multi-value same-dimension
  filters (OR semantics), cross-dimension AND, text query + filter
  combinations, the access facet's null-\`oa_status\` exclusion, cross-filtered
  count correctness against the 12-row fixture (including that a dimension's
  own counts aren't narrowed by its own filter), the discoverable-on-landing
  facet counts, and \`src/db/facets.ts\`'s parsing/allowlisting/capping and
  WHERE-building in isolation.
- \`tests/full-snapshot.test.ts\`: modality facet counts sum to
  \`entry_count\` across the real 5,643-row corpus (21 modalities), an
  access=paywalled filter returns exactly the \`oa_status='closed'\` rows, and
  a broad text query combined with a filter still paginates.
- \`e2e/routes.spec.ts\` (4 new tests): the landing page's filter checkboxes
  are discoverable and labeled, checking a box and submitting browses
  correctly with no query, a query+filter combination can legitimately
  return zero results, and Clear filters preserves the query while dropping
  every facet param, each with a zero-serious-violation axe scan.

## Staging: migration applied, smoke checks extended, no code deploy

Following 2A's precedent (which also promoted data without a Worker code
deploy, since old code is schema-tolerant of new columns it doesn't select),
this phase re-ran \`npm run db:promote:staging\` against the *same* full
snapshot content (checksum \`${manifest.checksum}\`): the only thing that
changes on staging is that \`wrangler d1 migrations apply\` now also applies
\`0005_facets.sql\`, adding the two new indexes to real remote D1.

An implementation-time correction from the plan's literal text: the plan
named \`scripts/smoke-staging.ts\` as the file to extend with a faceted-query
check, but that script is a Phase 1A-era harness hardcoded against
\`spike_fixture.sql\`'s synthetic ids/words, it hasn't reflected staging's
actual (real-corpus) content since Phase 1C. The smoke checks that actually
run after every real promotion live in \`scripts/smoke-checks.ts\`'s
\`runSmokeChecks()\`, invoked automatically by \`promote-snapshot.ts\`. That's
where the new faceted checks were added: a dynamically-discovered top
modality's audience breakdown and access-bucket breakdown, queried directly
against real remote D1, with results captured in this promotion's
\`evidence/promote-staging-*.json\`.

Deploying the updated Worker code itself (so the live staging *site* actually
serves the new checkbox UI, not just updated D1 indexes) is intentionally
left as a separate, deliberate action, same as production Worker deploys
were kept separate from data promotions in every prior phase.

## Exit gate

- \`npm run typecheck\` and \`npm test\` (Vitest, Workers runtime) pass.
- \`npm run test:e2e\` (Playwright + axe-core) passes, including the new
  faceted-browse suite, with zero serious/critical accessibility violations.
- The real corpus re-promotes to staging with migration \`0005_facets.sql\`
  applied and the extended smoke checks (\`facetModalityAudience\`,
  \`facetAccessBucket\`) present in the promotion evidence.
- Production was not touched this phase.

## Explicitly deferred to 2C+

- A repository read function for \`entry_neighbors\` and the related-entries
  UI: Phase 2C.
- Citation export (BibTeX/RIS/APA): Phase 2C.
- Deploying the updated Worker code to staging/production: a separate,
  deliberate action outside any data-promotion gate.
- Shareable shortlists, print support, and the OpenGraph card pipeline,
  later Phase 2 subphases per the roadmap.

## Stop

Phase 2B ends here. Do not start 2C until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-2b-decision-record.md"), decision);
  console.log("Wrote docs/phase-2b-decision-record.md");
  console.log("Phase 2B gate closed.");
}

main();
