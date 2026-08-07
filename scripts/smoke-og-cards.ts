import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags } from "./cli";
import { SITE_URL } from "../src/site-config";

config();

/**
 * Phase 2E: true edge/HTTP-level verification for the OpenGraph card
 * pipeline, complementing `smoke-live.ts`'s general route checks — this is
 * the roadmap's "card-validator" check for the *deployed* Worker + R2 pair,
 * as opposed to ACT's `validate_og_cards()` (a local, pre-upload check over
 * files on disk). Never run automatically by any gate script; run manually
 * against staging/production after a real deploy + `promote:og-cards`,
 * same convention as `smoke:live`.
 */

function usage(): never {
  throw new Error(
    "Usage: smoke-og-cards.ts --url <base-url>\n" +
      `  e.g. --url https://theallodium-staging.<subdomain>.workers.dev or --url ${SITE_URL}`,
  );
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EXPECTED_WIDTH = 1200;
const EXPECTED_HEIGHT = 630;

/** Parses a PNG's dimensions directly from its IHDR chunk (the mandatory
 * first chunk right after the 8-byte signature) — no image-parsing
 * dependency needed for a single, always-uncompressed header. Returns null
 * if the signature doesn't match. */
function parsePng(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== "IHDR") return null;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2));
  const base = flags.url?.replace(/\/$/, "");
  if (!base) usage();

  const results: CheckResult[] = [];
  function record(name: string, ok: boolean, detail?: string) {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  }

  async function checkCard(path: string, label: string): Promise<void> {
    const res = await fetch(`${base}${path}`);
    record(`GET ${path} -> 200 (${label})`, res.status === 200, `status=${res.status}`);
    const contentType = res.headers.get("content-type");
    record(`GET ${path} Content-Type is image/png (${label})`, contentType === "image/png", `content-type=${contentType}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const parsed = parsePng(bytes);
    record(`GET ${path} has a valid PNG signature (${label})`, parsed !== null, `bytes=${bytes.length}`);
    if (parsed) {
      record(
        `GET ${path} is ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT} (${label})`,
        parsed.width === EXPECTED_WIDTH && parsed.height === EXPECTED_HEIGHT,
        `actual=${parsed.width}x${parsed.height}`,
      );
    }
  }

  console.log(`Smoke-testing OG cards at ${base} …\n`);

  await checkCard("/og-default.png", "default card");

  console.log("\nDiscovering real entry ids from /sitemap.xml…");
  const sitemapRes = await fetch(`${base}/sitemap.xml`);
  const sitemapXml = await sitemapRes.text();
  const entryIds = Array.from(
    sitemapXml.matchAll(/\/psychotherapy\/entries\/([a-zA-Z0-9]+)/g),
  )
    .map((m) => m[1])
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 3);

  if (entryIds.length === 0) {
    record("sitemap.xml contains at least one entry id to sample", false);
  } else {
    record(
      "sitemap.xml contains at least one entry id to sample",
      true,
      `sampled: ${entryIds.join(", ")}`,
    );
    for (const id of entryIds) {
      await checkCard(`/og/${id}.png`, `entry ${id}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  mkdirSync("evidence", { recursive: true });
  const evidencePath = resolve(`evidence/smoke-og-cards-${Date.now()}.json`);
  writeFileSync(
    evidencePath,
    JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2),
  );
  console.log(`\nWrote ${evidencePath}`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
