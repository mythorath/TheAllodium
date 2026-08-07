import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./cli";

/** Shared helpers for `deployments/log.json` — the git-tracked, append-only
 * audit trail of every promotion and rollback, used by promote-snapshot.ts
 * and rollback-snapshot.ts. Never rewrites an existing entry. */

export interface DeploymentLogEntry {
  type: "promote" | "rollback" | "deploy";
  at: string;
  env: "staging" | "production";
  databaseName: string;
  gitCommit: string;
  [key: string]: unknown;
}

const LOG_PATH = resolve("deployments/log.json");

export function readDeploymentsLog(): DeploymentLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  return JSON.parse(readFileSync(LOG_PATH, "utf8")) as DeploymentLogEntry[];
}

export function appendDeploymentsLog(entry: DeploymentLogEntry): void {
  const log = readDeploymentsLog();
  log.push(entry);
  mkdirSync(resolve("deployments"), { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + "\n");
}

export function databaseNameFor(env: "staging" | "production"): string {
  return env === "production"
    ? "theallodium-psychotherapy-production"
    : "theallodium-psychotherapy-staging";
}

/** Matches the `name` field under `env.staging` / `env.production` in
 * wrangler.jsonc — used to build the *.workers.dev URL for smoke tests. */
export function workerNameFor(env: "staging" | "production"): string {
  return env === "production" ? "theallodium-production" : "theallodium-staging";
}

export function timeTravelBookmark(env: string): string {
  const result = run("npx", [
    "wrangler",
    "d1",
    "time-travel",
    "info",
    "DB",
    "--env",
    env,
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as { bookmark?: string };
  if (!parsed.bookmark) {
    throw new Error(`Could not read Time Travel bookmark for env=${env}: ${result.stdout}`);
  }
  return parsed.bookmark;
}

export function gitCommit(): string {
  const result = run("git", ["rev-parse", "HEAD"], { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}
