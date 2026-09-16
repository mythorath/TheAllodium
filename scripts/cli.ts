import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "./load-env";

config();

export function run(
  command: string,
  args: string[],
  options?: { allowFail?: boolean; env?: NodeJS.ProcessEnv },
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: resolve(process.cwd()),
    encoding: "utf8",
    env: { ...process.env, ...options?.env },
    // Default Node maxBuffer (1MB) is too small for a `wrangler d1 execute
    // --json` dump of thousands of rows (diff-snapshot-links.ts's
    // whole-table id/title/canonical_url query in particular): spawnSync
    // silently kills the process (status: null) rather than throwing when
    // it's exceeded, which is easy to misread as an unrelated failure.
    maxBuffer: 1024 * 1024 * 200,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0 && !options?.allowFail) {
    console.error(stdout);
    console.error(stderr);
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
  return { status: result.status ?? 1, stdout, stderr };
}

export function requireEnv(names: string[]): void {
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing required env vars (set in .env, values not printed): ${missing.join(", ")}`,
    );
  }
  console.log(`Env preflight: present [${names.join(", ")}]`);
}

export function mask(value: string | undefined): string {
  if (!value) return "(missing)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

/** Minimal `--flag value` / `--flag=value` / `--boolean-flag` argv parser,
 * no dependency on a CLI-args package, matching load-env.ts's philosophy. */
export function parseFlags(argv: string[]): {
  flags: Record<string, string>;
  booleans: Set<string>;
} {
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i += 1;
    } else {
      booleans.add(name);
    }
  }
  return { flags, booleans };
}
