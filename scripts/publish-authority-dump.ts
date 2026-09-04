import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { parseFlags, run } from "./cli";

const REQUIRED_FILES = [
  "import.sql",
  "manifest.json",
  "checksum.txt",
  "import.sql.sha256",
  "licenses.json",
] as const;
/** wrangler r2 object put refuses bodies above this size. */
const WRANGLER_R2_PUT_LIMIT = 300 * 1024 * 1024;

async function gzipFile(source: string, destination: string): Promise<void> {
  await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(destination));
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function putObject(bucket: string, key: string, path: string): void {
  run("npx", ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", path, "--remote"]);
}

async function main(): Promise<void> {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const directory = resolve(flags.directory ?? "exports/authority/latest");
  const bucket = flags.bucket ?? "theallodium-authority-dumps";
  const prefix = (flags.prefix ?? new Date().toISOString().slice(0, 10)).replace(
    /^\/+|\/+$/g,
    "",
  );
  if (!booleans.has("yes")) {
    throw new Error(
      "Refusing to upload without --yes. Pass --directory, --bucket, and --prefix to make the destination explicit.",
    );
  }
  for (const name of REQUIRED_FILES) {
    const path = resolve(directory, name);
    if (!existsSync(path)) throw new Error(`Missing authority artifact: ${path}`);
  }

  const importPath = resolve(directory, "import.sql");
  const expected = readFileSync(resolve(directory, "checksum.txt"), "utf8").trim();
  const actual = sha256File(importPath);
  if (actual !== expected) {
    throw new Error(`Authority import checksum mismatch: expected ${expected}, got ${actual}`);
  }

  const importSize = statSync(importPath).size;
  const uploadSqlAsGzip = importSize > WRANGLER_R2_PUT_LIMIT;
  const gzipPath = resolve(directory, "import.sql.gz");
  if (uploadSqlAsGzip) {
    await gzipFile(importPath, gzipPath);
    const gzipSha = sha256File(gzipPath);
    const gzipChecksumPath = resolve(directory, "import.sql.gz.sha256");
    writeFileSync(gzipChecksumPath, `${gzipSha}  import.sql.gz\n`, "utf8");
  }

  for (const name of REQUIRED_FILES) {
    if (name === "import.sql" && uploadSqlAsGzip) continue;
    const path = resolve(directory, name);
    putObject(bucket, `${prefix}/${basename(path)}`, path);
  }
  if (uploadSqlAsGzip) {
    putObject(bucket, `${prefix}/import.sql.gz`, gzipPath);
    putObject(bucket, `${prefix}/import.sql.gz.sha256`, resolve(directory, "import.sql.gz.sha256"));
  }
  console.log(
    uploadSqlAsGzip
      ? `Published checksummed authority artifacts to r2://${bucket}/${prefix}/ (import.sql gzipped; uncompressed SHA-256 ${actual}).`
      : `Published checksummed authority artifacts to r2://${bucket}/${prefix}/`,
  );
}

await main();
