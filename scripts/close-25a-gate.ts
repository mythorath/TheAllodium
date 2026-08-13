import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";

config();

function main() {
  console.log("Closing Phase 2.5A gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const decision = `# Phase 2.5A Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phase 2 shipped a working search engine over a catalog that is ~94% papers.
The empty landing refused to list anything until the reader typed a keyword
or checked a facet, and result rows hid the fields that sorts already used
(date, citations). Phase 2.5A makes the **baseline structure** honest:
literature vs. materials is a first-class split, \`kind\` alone is enough
to browse, and result rows plus the entry page show the fields people
already filter and sort by.

No migration, no contract version bump, no ACT exporter change.
\`resource_type\` was already indexed (\`idx_entries_type\`). \`SearchHit\`
gained four fields already on \`entries\` (\`published_date\`,
\`citation_count\`, \`audience\`, \`credibility_tier\`). \`CONTRACT_VERSION\`
stays \`"1.2"\`.

## Corpus split

\`kind=literature\` means \`e.resource_type = 'paper'\`. \`kind=materials\`
means everything else. Not \`credibility_tier\` — that mapping is almost
1:1 with papers vs. not, and would hide non-paper clinician protocols.

\`kind\` is exclusive (\`KindValue | null\`), parsed from a single \`?kind=\`
param. Unknown/empty values drop to null, so the "All" radio (\`kind=\`)
searches both sides. Keyword search with no \`kind\` still searches both.

Home renders two doors with live counts from \`getKindCounts()\` (a request-
time \`GROUP BY\`, not \`coverage_json\`, so this milestone needed no
snapshot rebuild). A quieter "Search everything" link keeps the old empty
landing reachable.

## Browse without a keyword

\`hasActiveFilters\` is true when \`kind !== null\`. The existing
no-query-plus-filters → \`browse\` branch then paginates that corpus.
No \`q\`, no \`kind\`, no other filters still returns \`mode: "empty"\`
and a two-door prompt rather than dumping 5,643 mixed rows.

## \`kind\` is a corpus selector, not a facet-to-clear

"Clear filters" drops modality/audience/access/storage/link_status and
**keeps** \`kind\`, \`q\`, and \`sort\`. Switching the Corpus radio to All
is how a reader leaves the split.

## Richer rows and the entry page

Search (and shortlist) result meta is now \`modality · type · audience\`
plus year (first four-digit run of \`published_date\`) plus citation count
when present, then org / blocked as before — so "newest" / "most cited"
sorts are visible, not magical.

The entry page shows an audience badge (the field was already a facet and
was invisible on the page) and lists structured \`authors\` when present,
falling back to the plain \`author\` string.

## Tests

- \`tests/repository.test.ts\`: parse/WHERE for kind, kind-only browse on
  the 12-row fixture (3 papers / 9 materials), keyword + kind stays inside
  papers, empty landing still empty, home doors, audience badge, structured
  author names on the paper entry.
- \`tests/full-snapshot.test.ts\`: \`getKindCounts()\` sums to the corpus,
  literature hits are all papers, materials hits are none, home HTML carries
  live counts.
- \`e2e/routes.spec.ts\`: home doors, corpus radios, \`?kind=materials\`
  browse with audience on the result row, Clear-filters keeps kind, no-JS
  kind browse.

## Exit gate

- \`npm run secrets:scan\`, \`typecheck\`, \`test\` (Vitest, Workers runtime)
  pass.
- \`npm run test:e2e\` (Playwright + axe-core) passes, including the new
  corpus-split suite, with zero serious/critical accessibility violations.
- Neither staging nor production was touched this phase.

## Explicitly deferred to 2.5B+

- Topic / hexaflex / type / decade facets and clickable tags — 2.5B.
- Directory landings (\`/psychotherapy/topics\`, \`/hexaflex\`) — 2.5C.
- Facet auto-submit, compact pagination, \`?like={id}\` — 2.5D.
- Deploying the updated Worker code to staging/production — a separate,
  deliberate action outside any phase gate.

## Stop

Phase 2.5A ends here. Do not start 2.5B until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-2.5a-decision-record.md"), decision);
  console.log("Wrote docs/phase-2.5a-decision-record.md");
  console.log("Phase 2.5A gate closed.");
}

main();
