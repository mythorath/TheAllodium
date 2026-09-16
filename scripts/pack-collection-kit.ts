import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./cli";

/** Packs collection-kit/ plus the minerals fixture (as `example/`) into one
 * tarball to hand to an outside author. Staged in a temp directory so the
 * repository never carries a generated copy of the example. */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT_DIR = join(ROOT, "collection-kit");
const EXAMPLE_SRC = join(ROOT, "fixtures", "example-collection");
const TARBALL = join(KIT_DIR, "allodium-collection-kit.tgz");

function main() {
  for (const required of ["SPEC.md", "AGENTS.md", "validate.mjs", "write-checksums.mjs"]) {
    if (!existsSync(join(KIT_DIR, required))) {
      throw new Error(`collection-kit/${required} is missing`);
    }
  }

  const staging = mkdtempSync(join(tmpdir(), "allodium-kit-"));
  try {
    const kitStage = join(staging, "collection-kit");
    cpSync(KIT_DIR, kitStage, {
      recursive: true,
      filter: (src) => src !== TARBALL,
    });
    cpSync(EXAMPLE_SRC, join(kitStage, "example"), { recursive: true });

    mkdirSync(KIT_DIR, { recursive: true });
    if (existsSync(TARBALL)) rmSync(TARBALL);
    run("tar", ["-czf", TARBALL, "-C", staging, "collection-kit"]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  console.log(`Wrote ${TARBALL}`);
  console.log("  (regenerate any time; the tarball is not tracked in git)");
}

main();
