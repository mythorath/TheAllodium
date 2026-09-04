import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./cli";

const PHASES = ["5a", "5b", "5c", "5d", "5e", "5f", "5g", "5h"] as const;
type Phase = (typeof PHASES)[number];

type GateDefinition = {
  title: string;
  proof: string;
  requiredFiles: readonly string[];
};

const GATES: Record<Phase, GateDefinition> = {
  "5a": {
    title: "Federation contract and risk spike",
    proof: "The normalized adapter contract, fail-open behavior, identity strategy, and repeatable latency spike exist.",
    requiredFiles: [
      "docs/federation-contract-v1.md",
      "src/federation/types.ts",
      "src/federation/adapters.ts",
      "scripts/spike-federation.ts",
      "tests/federation.test.ts",
    ],
  },
  "5b": {
    title: "Authority layer",
    proof: "Authority data has an independent D1 schema, deterministic snapshot builder, provenance, and read repository.",
    requiredFiles: [
      "authority-migrations/0001_authority_schema.sql",
      "src/authority/repository.ts",
      "scripts/fetch-authority-sources.py",
      "scripts/build-authority-snapshot.py",
      "docs/authority-data.md",
    ],
  },
  "5c": {
    title: "Credibility engine",
    proof: "Credibility is a deterministic, explainable allow-list score whose absences remain neutral.",
    requiredFiles: [
      "src/credibility/score.ts",
      "tests/credibility.test.ts",
      "docs/credibility-standard-v1.md",
    ],
  },
  "5d": {
    title: "Federated search",
    proof: "Public search fans out through isolated adapters, respects upstream limits, caches results, and reports partial failures.",
    requiredFiles: [
      "src/federation/service.ts",
      "src/federation/cache.ts",
      "src/federation/rate-limiter.ts",
      "src/views/open-index-pages.tsx",
    ],
  },
  "5e": {
    title: "Field map",
    proof: "The OpenAlex hierarchy drives field routes and the sitemap while curated collections remain distinct.",
    requiredFiles: [
      "src/authority/types.ts",
      "src/collections.ts",
      "src/sitemap.ts",
    ],
  },
  "5f": {
    title: "Work pages and identity",
    proof: "DOI work pages resolve through the federation and no-DOI records use an explicit secondary identity tier.",
    requiredFiles: [
      "src/federation/identity.ts",
      "src/views/open-index-pages.tsx",
    ],
  },
  "5g": {
    title: "Coverage honesty",
    proof: "The public coverage surface names responding sources and structural blind spots, backed by recurring health evidence.",
    requiredFiles: [
      "src/open-index/coverage.ts",
      "docs/open-index-coverage.md",
      "scripts/audit-federation-health.ts",
    ],
  },
  "5h": {
    title: "Distribution",
    proof: "The federation is available over MCP and the authority snapshot has scripts for licensed R2 and Zenodo distribution.",
    requiredFiles: [
      "src/mcp.ts",
      "scripts/publish-authority-dump.ts",
      "scripts/publish-authority-zenodo.ts",
    ],
  },
};

function parsePhase(value: string | undefined): Phase {
  if (PHASES.includes(value as Phase)) return value as Phase;
  throw new Error(`Usage: close-5-gate.ts ${PHASES.join("|")}`);
}

function writeDecision(phase: Phase, gate: GateDefinition): void {
  const path = resolve(`docs/phase-${phase}-decision-record.md`);
  if (existsSync(path)) {
    console.log(`Closed Phase ${phase.toUpperCase()}; preserved existing decision record.`);
    return;
  }
  const decision = `# Phase ${phase.toUpperCase()} Decision Record

Generated: ${new Date().toISOString()}

## What this phase proved

${gate.proof}

## Required artifacts

${gate.requiredFiles.map((path) => `- \`${path}\``).join("\n")}

## Exit gate

- \`npm run secrets:scan\`, \`npm run typecheck\`, and \`npm test\` pass.
- Existing psychotherapy routes and publication contract remain available.
- Upstream and authority failures degrade to explicit uncertainty, never fabricated negative evidence.

## Operational boundary

This gate verifies code and deterministic local behavior. It does not claim
that every upstream index answered, that the authority snapshot is current,
or that a production deploy occurred. Those facts require timestamped
evidence and are reported separately.
`;
  mkdirSync(resolve("docs"), { recursive: true });
  writeFileSync(path, decision);
  console.log(`Closed Phase ${phase.toUpperCase()} and wrote its decision record.`);
}

function main(): void {
  const requested = process.argv[2]?.toLowerCase();
  const phases: readonly Phase[] =
    requested === "all" ? PHASES : [parsePhase(requested)];
  const missing = phases.flatMap((phase) =>
    GATES[phase].requiredFiles.filter((path) => !existsSync(resolve(path))),
  );
  if (missing.length > 0) {
    throw new Error(`Cannot close Phase 5; missing: ${[...new Set(missing)].join(", ")}`);
  }

  run("npm", ["run", "secrets:scan"]);
  run("npm", ["run", "typecheck"]);
  run("npm", ["run", "test"]);
  for (const phase of phases) writeDecision(phase, GATES[phase]);
}

main();
