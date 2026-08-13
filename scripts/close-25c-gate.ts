import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";

config();

function main() {
  console.log("Closing Phase 2.5C gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);

  console.log("Running the accessibility/route/search smoke suite (Playwright + axe-core)…");
  run("npm", ["run", "test:e2e"]);

  const decision = `# Phase 2.5C Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

Phase 2.5B made topic and hexaflex filterable, but the catalog still had
no map: the only way to arrive at those dimensions was the search form or
an entry's tag list. Phase 2.5C adds server-rendered directory landings
that emit search URLs, a home directory strip, and nav/sitemap entries so
a reader can arrive without a keyword.

Search stays the engine. These routes are indexes. No migration, no
contract version bump, no ACT exporter change. \`CONTRACT_VERSION\` stays
\`"1.2"\`. The \`e.id ASC\` sort tiebreaker is unchanged. No search
\`ORDER BY\` / result-set SQL changed, so live \`audit:links\` is not
part of this gate.

## Directory landings

- \`GET /psychotherapy/topics\` lists topic tags with live counts from
  \`getTagCounts(db, "topic")\`, each linking to
  \`/psychotherapy/search?topic={name}\` (both corpora).
- \`GET /psychotherapy/hexaflex\` lists hexaflex processes with counts
  from \`getTagCounts(db, "hexaflex")\`, each linking to
  \`/psychotherapy/search?kind=materials&hexaflex={name}\` so client
  exercises are not buried under papers. The page states that Literature
  can be added on search.

Counts are a request-time \`GROUP BY t.name\`, not \`coverage_json\` and
not \`computeFacetCounts\` (which fires ten cross-filtered queries).
Zero-count tags do not appear. Order is alphabetical.

## Home, nav, sitemap

Home grows a quieter Catalog strip (Topics, Hexaflex, Search) under the
two doors. The existing "Search everything" and "How verification works"
CTAs stay. Primary nav is Search, Topics, Hexaflex, The Standard,
Shortlist.

\`STATIC_SITEMAP_PATHS\` gained the two landings (static count 4 → 6).
Tests and \`smoke-live.ts\` now use \`STATIC_SITEMAP_PATHS.length\` so
the count cannot drift. \`llms.txt\` lists both pages.

## Tests

- \`tests/repository.test.ts\`: spike \`getTagCounts\` (3 topics / 2
  hexaflex), landing HTML hrefs, home/nav links, canonicals, sitemap
  \`12 + STATIC_SITEMAP_PATHS.length\`.
- \`tests/full-snapshot.test.ts\`: topic landing link count matches
  \`getTagCounts\`; hexaflex hrefs all include \`kind=materials\`;
  sitemap uses the constant.
- \`e2e/routes.spec.ts\`: home strip + nav, topics click →
  \`?topic=depression\`, hexaflex materials-biased href, no-JS topics
  list, axe green.

## Exit gate

- \`npm run secrets:scan\`, \`typecheck\`, \`test\` (Vitest, Workers runtime)
  pass.
- \`npm run test:e2e\` (Playwright + axe-core) passes, including the new
  directory suite, with zero serious/critical accessibility violations.
- Neither staging nor production was touched this phase.

## Explicitly deferred to 2.5D+

- Facet auto-submit, compact pagination, \`?like={id}\` — 2.5D.
- Within-modality process tags (CBT skill, DBT module, …) as global facets.
- \`source_org\` facet, author browse, abstract FTS, LLM.
- Deploying the updated Worker code to staging/production — a separate,
  deliberate action outside any phase gate.

## Stop

Phase 2.5C ends here. Do not start 2.5D until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-2.5c-decision-record.md"), decision);
  console.log("Wrote docs/phase-2.5c-decision-record.md");
  console.log("Phase 2.5C gate closed.");
}

main();
