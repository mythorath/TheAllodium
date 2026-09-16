import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";

config();

function main() {
  console.log("Closing Phase 2.5D gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const decision = `# Phase 2.5D Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phases 2.5A–C made search a structured catalog: literature/materials
doors, topic/hexaflex/type/decade facets, and directory landings. The
form still required a Search click for every facet change, pagination
was Previous/Next only, and "related entries" on an entry page had no
way to open that neighborhood as a search. Phase 2.5D is interaction
polish on that engine, progressive enhancement, a compact pager, and
\`?like={id}\` as a neighbors search mode.

No migration, no contract version bump, no ACT exporter change, no
deploy. \`CONTRACT_VERSION\` stays \`"1.2"\`. The \`e.id ASC\` sort
tiebreaker is unchanged. Live \`audit:links\` is not part of this gate;
the new SQL path is covered by local neighbor-order tests.

## Facet auto-submit

Facet checkboxes gained \`data-auto-submit\`. \`public/app.js\` already
submits the enclosing GET form on \`change\` for that attribute (sort
uses it). Corpus radios stay manual. Without JavaScript, Search still
submits the form.

## Compact pagination

Previous/Next stay. First appears when \`page > 2\` (Previous already
reaches page 1). Last appears when \`page < totalPages - 1\`. \`Page N
of M\` moved into the pager as a non-link status span; the results meta
line keeps the result count and drops the duplicate page fraction.
There are still no numbered page buttons.

## Neighbors search (\`?like={id}\`)

Internal mode name is \`"neighbors"\`: not the SQL LIKE fallback
(\`fallback=1\` → \`mode: "like"\`). Query param is \`like\`.

If trimmed \`q\` is non-empty, keyword search wins and \`like\` is
ignored. If \`q\` is empty and \`like\` is a non-empty id, neighbors
mode. Facets still AND via \`FacetFilters\`.

Relevance/default order is \`n.rank ASC, n.neighbor_id ASC, e.id ASC\`
(same neighborhood as \`getRelatedEntries()\`, plus the locked id
tiebreaker). Other sorts reorder the subset through existing
\`sortOrderBy\`. The seed entry is not in the set. Missing id or zero
neighbors: \`mode: "neighbors"\`, \`total === 0\`, honest copy, not a
404.

The entry page grows a "More like this" link to
\`/psychotherapy/search?like={id}\` when \`related.length > 0\`. The
search form keeps a hidden \`like\` field in neighbors mode so facet
auto-submit and Clear filters preserve it. Clear-filters keeps \`kind\`,
\`q\`, \`sort\`, and \`like\`.

## Tests

- \`tests/repository.test.ts\`: spike \`like=aaaaaaaa00000001\` rank
  order (stable on a second call), \`kind=materials\` keeps only the
  worksheet neighbor, keyword \`q\` wins over \`like\`, unknown id is
  neighbors with total 0, search HTML has the hidden field and
  similar-to copy, facet checkboxes have \`data-auto-submit\`, entry
  HTML has "More like this" only when neighbors exist.
- \`tests/full-snapshot.test.ts\`: \`q=act\` page 1 has Next + Last and
  no First/Previous; page 2 has Previous (no First); page 3 has First;
  an entry with 10 neighbors returns \`mode: "neighbors"\`, \`total ===
  10\`, ids matching \`getRelatedEntries\` order; \`CONTRACT_VERSION\`
  still \`"1.2"\`.
- \`e2e/routes.spec.ts\`: facet checkbox auto-submits with JS; no-JS
  still requires Search; "More like this" opens two neighbor hits;
  no-JS href still works; axe green.

## Exit gate

- \`npm run secrets:scan\`, \`typecheck\`, \`test\` (Vitest, Workers runtime)
  pass.
- \`npm run test:e2e\` (Playwright + axe-core) passes, including the new
  auto-submit, pager, and neighbors coverage, with zero serious/critical
  accessibility violations.
- Neither staging nor production was touched this phase.

## Explicitly deferred

- Within-modality process tags (CBT skill, DBT module, …) as global facets.
- \`source_org\` facet, author browse, abstract FTS, LLM / Phase 3.
- Numbered page button lists, facet auto-submit on corpus radios,
  changing \`PAGE_SIZE\`.
- Deploying the updated Worker code to staging/production: a separate,
  deliberate action outside any phase gate.

## Stop

Phase 2.5D ends here. Do not start Phase 3 until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-2.5d-decision-record.md"), decision);
  console.log("Wrote docs/phase-2.5d-decision-record.md");
  console.log("Phase 2.5D gate closed.");
}

main();
