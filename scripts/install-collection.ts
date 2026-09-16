import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./load-env";
import { parseFlags, requireEnv, run } from "./cli";
import { validateCollectionBundle } from "../src/collections/validate-bundle";
import { upsertD1Binding, type WranglerD1Env } from "./wrangler-d1-binding";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRIBUTED_DIR = join(ROOT, "src", "contributed");
const MODULES_DIR = join(ROOT, "collection-modules");
const INSTALLED_TS = join(ROOT, "src", "collections", "installed.ts");
const WRANGLER_PATH = join(ROOT, "wrangler.jsonc");

function usage(): never {
  throw new Error(
    "Usage: install-collection.ts --dir <unpacked-collection> [--skip-remote] [--yes]\n" +
      "  Validates the bundle, copies it into the repo, patches wrangler.jsonc and the\n" +
      "  installed-module registry, then creates staging (and with --yes, production) D1s.",
  );
}

function importName(slug: string): string {
  return slug.replace(/-/g, "_");
}

function localDatabaseId(slug: string): string {
  const hex = [...slug].reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16).padStart(2, "0"), "");
  const padded = (hex + "00000000000000000000000000000000").slice(0, 32);
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

function listContributedSlugs(): string[] {
  if (!existsSync(CONTRIBUTED_DIR)) return [];
  return readdirSync(CONTRIBUTED_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(CONTRIBUTED_DIR, entry.name, "index.tsx")))
    .map((entry) => entry.name)
    .sort();
}

function writeInstalledRegistry(slugs: string[]): void {
  const imports = slugs
    .map((slug) => `import ${importName(slug)} from "../contributed/${slug}";\n`)
    .join("");
  const entries = slugs.map((slug) => `    ${importName(slug)},\n`).join("");
  const body =
    `import type { CollectionModuleDefinition } from "./module";\n` +
    imports +
    `\n/** Static imports of installed contributed collections. Install appends here. */\n` +
    `export const INSTALLED_COLLECTION_MODULES: readonly CollectionModuleDefinition[] =\n` +
    (slugs.length > 0 ? `  [\n${entries}  ];\n` : "  [];\n");
  writeFileSync(INSTALLED_TS, body);
}

function parseDatabaseId(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  const match =
    combined.match(/database_id\s*=\s*"([^"]+)"/i) ||
    combined.match(/database_id["']?\s*:\s*["']([^"']+)["']/i) ||
    combined.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!match) {
    throw new Error(`Could not parse database_id from wrangler d1 create output:\n${combined}`);
  }
  return match[1];
}

function createRemoteDatabase(name: string): string {
  const result = run("npx", ["wrangler", "d1", "create", name]);
  return parseDatabaseId(result.stdout, result.stderr);
}

function patchWrangler(env: WranglerD1Env, spec: Parameters<typeof upsertD1Binding>[2]): void {
  const current = readFileSync(WRANGLER_PATH, "utf8");
  writeFileSync(WRANGLER_PATH, upsertD1Binding(current, env, spec));
}

function copyBundle(srcDir: string, slug: string): void {
  const destData = join(MODULES_DIR, slug);
  const destSrc = join(CONTRIBUTED_DIR, slug);
  mkdirSync(MODULES_DIR, { recursive: true });
  mkdirSync(CONTRIBUTED_DIR, { recursive: true });
  if (existsSync(destData)) rmSync(destData, { recursive: true });
  if (existsSync(destSrc)) rmSync(destSrc, { recursive: true });
  mkdirSync(destData, { recursive: true });
  for (const name of ["collection.json", "import.sql", "manifest.json", "checksum.txt"]) {
    cpSync(join(srcDir, name), join(destData, name));
  }
  cpSync(join(srcDir, "src"), destSrc, { recursive: true });
}

function main() {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const dir = flags.dir;
  if (!dir) usage();
  const srcDir = resolve(dir);
  const result = validateCollectionBundle(srcDir);
  const slug = result.slug;
  const binding = result.binding;
  console.log(`Installing collection ${slug} as ${binding} (${result.entryCount} entries)`);

  copyBundle(srcDir, slug);
  writeInstalledRegistry(listContributedSlugs());

  patchWrangler("default", {
    binding,
    databaseName: `theallodium-${slug}-local`,
    databaseId: localDatabaseId(slug),
    migrationsDir: "collection-migrations",
    comment: `Contributed collection ${slug}`,
  });

  if (booleans.has("skip-remote")) {
    console.log("Skipped remote D1 create (--skip-remote).");
    console.log(`Copied ${slug} into collection-modules/${slug} and src/contributed/${slug}.`);
    return;
  }

  requireEnv(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);

  const stagingId = createRemoteDatabase(`theallodium-${slug}-staging`);
  patchWrangler("staging", {
    binding,
    databaseName: `theallodium-${slug}-staging`,
    databaseId: stagingId,
    migrationsDir: "collection-migrations",
  });
  run("npx", [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    binding,
    "--env",
    "staging",
    "--remote",
  ]);

  if (booleans.has("yes")) {
    const productionId = createRemoteDatabase(`theallodium-${slug}-production`);
    patchWrangler("production", {
      binding,
      databaseName: `theallodium-${slug}-production`,
      databaseId: productionId,
      migrationsDir: "collection-migrations",
    });
    run("npx", [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      binding,
      "--env",
      "production",
      "--remote",
    ]);
  } else {
    console.log("Skipped production D1 create (pass --yes to create it).");
  }

  console.log(
    `Installed ${slug}. Promote with:\n` +
      `  npx tsx scripts/promote-snapshot.ts --env staging --snapshot-dir collection-modules/${slug}`,
  );
}

main();
