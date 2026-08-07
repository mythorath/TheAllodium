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
