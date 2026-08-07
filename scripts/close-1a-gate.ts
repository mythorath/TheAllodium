import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { run } from "./cli";

config();

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  console.log("Closing Phase 1A gate…");

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);
  run("npm", ["run", "db:smoke:local"]);

  const local = readJson(resolve("evidence/local-smoke.json"));
  const staging = readJson(resolve("evidence/staging-smoke.json"));

  if (!staging) {
    throw new Error(
      "Missing evidence/staging-smoke.json — run npm run db:create:staging && npm run db:migrate:staging && npm run db:smoke:staging first",
    );
  }

  const decision = `# Phase 1A Decision Record

Generated: ${new Date().toISOString()}

## Proven

- Hono + TypeScript JSX SSR Worker scaffold exists in \`/tank/TheAllodium\`.
- Publication contract v1 documented in \`docs/publication-contract-v1.md\` and enforced in \`src/contract.ts\`.
- Candidate D1 schema: entries, tags, entry_tags, entry_verifications, entry_aliases, snapshot_manifest, entry_search_documents, entry_fts.
- Local D1: migrate → fixture → FTS full rebuild works.
- Remote staging D1: migrate → fixture → FTS full rebuild works.
- Routes: \`/psychotherapy/entries/:id\` (canonical, alias 301, 404) and \`/psychotherapy/search\`.
- LIKE fallback searches title+meta only; abstracts never appear in HTML/results.
- Abstract indexing is feature-gated via \`snapshot_manifest.abstract_search_enabled\`.
- Secrets scan passed (credentials stay in \`.env\` only).

## Chosen defaults (locked by spike)

| Decision | Choice |
|----------|--------|
| FTS tokenizer | \`porter unicode61\` |
| FTS columns | \`entry_id UNINDEXED\`, \`title\`, \`meta\`, \`abstract_text\` (empty unless gate on) |
| Ranking | \`bm25(entry_fts) ASC\`, tie-break \`title ASC\` |
| Query sanitization | alphanumeric tokens ≥2 chars; FTS as quoted prefix terms joined by AND |
| Pagination | page size 10; \`page\` query param |
| LIKE fallback | \`lower(title|meta) LIKE %needle%\` after stripping \`%\`/\`_\`; used when FTS missing/errors or \`fallback=1\` |
| Snapshot replace (fixture scale) | In-place: delete content tables → insert → drop/recreate FTS. No binding swap required at spike scale. |
| Abstract policy | Off by default; rights review required before production enablement |

## Latency evidence (fixture only — not a 5,643-row prediction)

Local smoke:
\`\`\`json
${JSON.stringify(local, null, 2)}
\`\`\`

Staging smoke:
\`\`\`json
${JSON.stringify(staging, null, 2)}
\`\`\`

Acceptance for this spike: fixture FTS/LIKE queries complete successfully locally and remotely; no hard latency SLA claimed for full corpus.

## Explicitly deferred to 1B+

- Structured ACT verification tables / backfill from \`notes\`
- Dedupe alias production from live merges
- Field-level rights states for abstracts
- Deterministic full 5,643-row SQL snapshot + checksum pipeline
- Staging→production promotion/rollback runbook
- Public UI polish, \`/standard/\`, domains, SEO surfaces

## Stop

Phase 1A ends here. Do not start 1B until this record is accepted.
`;

  mkdirSync("docs", { recursive: true });
  writeFileSync(resolve("docs/phase-1a-decision-record.md"), decision);
  console.log("Wrote docs/phase-1a-decision-record.md");
  console.log("Phase 1A gate closed.");
}

main();
