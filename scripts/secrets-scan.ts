import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { config as loadDotenv } from "./load-env";

const root = new URL("..", import.meta.url).pathname;

loadDotenv();

const secretValues = [
  process.env.CLOUDFLARE_API_TOKEN,
  process.env.SECRET_ACCESS_KEY,
  process.env.ACCESS_KEY_ID,
].filter((v): v is string => Boolean(v && v.length >= 8));

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".wrangler",
  "dist",
  "coverage",
  "evidence",
  "test-results",
  "playwright-report",
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    if (name === ".env") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function main() {
  const offenders: string[] = [];
  for (const file of walk(root)) {
    if (file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".npy")) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const secret of secretValues) {
      if (text.includes(secret)) {
        offenders.push(relative(root, file));
      }
    }
    // Also catch accidental inline token-looking assignments in tracked configs.
    if (
      /CLOUDFLARE_API_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/.test(text) &&
      !file.endsWith(".env.example")
    ) {
      offenders.push(relative(root, file));
    }
  }

  if (offenders.length > 0) {
    console.error("Secret leak scan failed:");
    for (const o of [...new Set(offenders)]) console.error(`  - ${o}`);
    process.exit(1);
  }
  console.log("Secret leak scan: ok");
}

main();
