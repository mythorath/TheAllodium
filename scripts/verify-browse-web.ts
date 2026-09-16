import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseFlags, run } from "./cli";
import { config } from "./load-env";
import {
  DEFAULT_STATE_DIR,
  DEFAULT_VERIFY_ORIGIN,
  DOI_QUEUE_FILENAME,
  HUB_PAGES_FILENAME,
  extractOriginalPaperDoisFromSql,
  parseJsonlRecords,
  runBrowseVerification,
  type DoiQueueRecord,
  type HubRecord,
} from "./verify-browse-lib";

config();

function usage(): never {
  throw new Error(
    "Usage: verify-browse-web.ts [--url <origin>] [--state-dir <dir>] [--env staging|production] [--local]\n" +
      "  [--pass all|a|b] [--fresh] [--fixture-sql <path>] [--skip-authority]\n" +
      "  [--max-hubs N] [--max-dois N] [--max-hub-failures N] [--max-resolve-failures N]\n" +
      "  [--concurrency N] [--pass-b-concurrency N] [--delay-ms N] [--pass-b-delay-ms N]\n" +
      "  [--summarize] [--summarize-env local|staging|production] [--summarize-yes]\n" +
      `  Default origin: ${DEFAULT_VERIFY_ORIGIN}\n` +
      `  Default state dir: ${DEFAULT_STATE_DIR}`,
  );
}

function intFlag(flags: Record<string, string>, name: string): number | undefined {
  const raw = flags[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative number`);
  }
  return value;
}

function loadJsonlFile<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return parseJsonlRecords<T>(readFileSync(path, "utf8"));
}

function appendJsonl(path: string, record: object): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function loadRetractionDois(options: {
  fixtureSql?: string;
  skipAuthority: boolean;
  envName: string;
  local: boolean;
}): string[] {
  if (options.fixtureSql) {
    return extractOriginalPaperDoisFromSql(readFileSync(resolve(options.fixtureSql), "utf8"));
  }
  if (options.skipAuthority) return [];
  const sql =
    "SELECT DISTINCT original_paper_doi AS doi FROM retraction_watch_notices " +
    "WHERE original_paper_doi IS NOT NULL AND TRIM(original_paper_doi) != ''";
  const args = ["wrangler", "d1", "execute", "AUTHORITY"];
  if (options.local) {
    args.push("--local");
  } else {
    args.push("--env", options.envName, "--remote");
  }
  args.push("--json", "--command", sql, "--yes");
  const result = run("npx", args);
  const parsed = JSON.parse(result.stdout) as Array<{ results?: Array<{ doi?: string }> }>;
  return (parsed[0]?.results ?? [])
    .map((row) => row.doi)
    .filter((doi): doi is string => Boolean(doi && doi.trim()));
}

function invokeSummarize(queuePath: string, envName: string, yes: boolean): void {
  const args = [
    "scripts/generate_federated_overviews.py",
    "--doi-queue",
    queuePath,
    "--env",
    envName,
  ];
  if (yes) args.push("--yes");
  const result = spawnSync("python3", args, {
    cwd: resolve(process.cwd()),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`generate_federated_overviews.py exited ${result.status ?? "null"}`);
  }
}

async function main(): Promise<void> {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  if (booleans.has("help") || flags.help === "") usage();

  const origin = (flags.url ?? DEFAULT_VERIFY_ORIGIN).replace(/\/$/, "");
  const stateDir = resolve(flags["state-dir"] ?? DEFAULT_STATE_DIR);
  const envName = flags.env ?? "staging";
  if (envName !== "staging" && envName !== "production") usage();
  const pass = flags.pass ?? "all";
  if (pass !== "all" && pass !== "a" && pass !== "b") usage();
  const hubPath = resolve(stateDir, HUB_PAGES_FILENAME);
  const doiPath = resolve(stateDir, DOI_QUEUE_FILENAME);

  if (booleans.has("fresh")) {
    if (existsSync(hubPath)) rmSync(hubPath);
    if (existsSync(doiPath)) rmSync(doiPath);
  }
  mkdirSync(stateDir, { recursive: true });

  const priorHubs = loadJsonlFile<HubRecord>(hubPath);
  const priorDois = loadJsonlFile<DoiQueueRecord>(doiPath);
  const doneHubs = new Set(priorHubs.map((row) => row.url));
  const doneDois = new Set(priorDois.map((row) => row.doi));

  const retractionDois = loadRetractionDois({
    fixtureSql: flags["fixture-sql"],
    skipAuthority: booleans.has("skip-authority"),
    envName,
    local: booleans.has("local"),
  });

  const result = await runBrowseVerification({
    origin,
    fetchImpl: fetch,
    retractionDois,
    passA: pass === "all" || pass === "a",
    passB: pass === "all" || pass === "b",
    passAConcurrency: intFlag(flags, "concurrency") ?? 4,
    passBConcurrency: intFlag(flags, "pass-b-concurrency") ?? 1,
    delayMs: intFlag(flags, "delay-ms") ?? 200,
    passBDelayMs: intFlag(flags, "pass-b-delay-ms") ?? 250,
    maxHubs: intFlag(flags, "max-hubs"),
    maxDois: intFlag(flags, "max-dois"),
    maxHubFailures: intFlag(flags, "max-hub-failures") ?? 0,
    maxResolveFailures: intFlag(flags, "max-resolve-failures") ?? Number.MAX_SAFE_INTEGER,
    doneHubs,
    doneDois,
    onHub: (record) => {
      appendJsonl(hubPath, record);
    },
    onDoi: (record) => {
      appendJsonl(doiPath, record);
    },
  });

  const summary = {
    origin,
    stateDir,
    hubOk: result.hubOk,
    hubRedirect: result.hubRedirect,
    hubFailure: result.hubFailure,
    doisResolved: result.doisResolved,
    doisFailed: result.doisFailed,
    queuedDois: priorDois.length + result.dois.length,
    fetched: result.fetchedUrls.length,
    doiQueue: doiPath,
  };
  writeFileSync(
    resolve(stateDir, "last-run.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));

  if (booleans.has("summarize")) {
    const summarizeEnv = flags["summarize-env"] ?? (booleans.has("local") ? "local" : envName);
    invokeSummarize(doiPath, summarizeEnv, booleans.has("summarize-yes"));
  }

  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

await main();
