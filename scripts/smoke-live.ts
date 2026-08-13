import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags } from "./cli";
import { SITE_URL } from "../src/site-config";
import { STATIC_SITEMAP_PATHS } from "../src/sitemap";

config();

/**
 * Phase 1F: true edge/HTTP-level verification, complementing the existing
 * D1-level `smoke-checks.ts` (data correctness via `wrangler d1 execute`).
 * Generalized to run against either a staging *.workers.dev URL or the
 * production custom domain.
 */

function usage(): never {
  throw new Error(
    "Usage: smoke-live.ts --url <base-url>\n" +
      `  e.g. --url https://theallodium-staging.<subdomain>.workers.dev or --url ${SITE_URL}\n` +
      `  The theallodium.com -> ${SITE_URL} redirect check only runs when --url is exactly ${SITE_URL}.`,
  );
}

const SECURITY_HEADER_KEYS = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "content-security-policy",
  "permissions-policy",
];

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
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

  async function checkPage(path: string, expectedSubstring: string): Promise<Response> {
    const res = await fetch(`${base}${path}`);
    record(`GET ${path} -> 200`, res.status === 200, `status=${res.status}`);
    const missingHeaders = SECURITY_HEADER_KEYS.filter((h) => !res.headers.get(h));
    record(
      `GET ${path} carries the security header set`,
      missingHeaders.length === 0,
      missingHeaders.length ? `missing: ${missingHeaders.join(", ")}` : undefined,
    );
    record(`GET ${path} sets no Set-Cookie`, !res.headers.get("set-cookie"));
    const body = await res.text();
    record(`GET ${path} contains "${expectedSubstring}"`, body.includes(expectedSubstring));
    return res;
  }

  console.log(`Smoke-testing ${base} …\n`);

  const healthRes = await fetch(`${base}/health`);
  record("GET /health -> 200", healthRes.status === 200, `status=${healthRes.status}`);
  const health = (await healthRes.json()) as { entry_count?: number };
  record(
    "GET /health reports entry_count > 0",
    Boolean(health.entry_count && health.entry_count > 0),
    `entry_count=${health.entry_count}`,
  );

  await checkPage("/", "The Allodium");
  await checkPage("/psychotherapy/search", "Psychotherapy search");
  await checkPage("/psychotherapy/topics", "Topics");
  await checkPage("/psychotherapy/hexaflex", "Hexaflex");
  await checkPage("/standard", "The Standard");
  await checkPage("/disclaimer", "988");

  const sitemapRes = await fetch(`${base}/sitemap.xml`);
  record("GET /sitemap.xml -> 200", sitemapRes.status === 200, `status=${sitemapRes.status}`);
  const sitemapXml = await sitemapRes.text();
  const urlCount = (sitemapXml.match(/<url>/g) ?? []).length;
  const expectedCount = (health.entry_count ?? 0) + STATIC_SITEMAP_PATHS.length;
  record(
    "sitemap.xml url count matches /health entry_count plus static routes",
    urlCount === expectedCount,
    `sitemap=${urlCount}, expected=${expectedCount}`,
  );

  const entryMatch = sitemapXml.match(/\/psychotherapy\/entries\/([a-zA-Z0-9]+)/);
  if (entryMatch) {
    await checkPage(`/psychotherapy/entries/${entryMatch[1]}`, "Verification");
  } else {
    record("sitemap.xml contains at least one entry URL", false);
  }

  const robotsRes = await fetch(`${base}/robots.txt`);
  const robotsBody = await robotsRes.text();
  record(
    "robots.txt references sitemap.xml",
    robotsRes.status === 200 && robotsBody.includes("sitemap.xml"),
  );

  const notFoundRes = await fetch(`${base}/this-route-does-not-exist`);
  record("unknown route -> 404", notFoundRes.status === 404, `status=${notFoundRes.status}`);

  if (base === SITE_URL) {
    const comRes = await fetch("https://theallodium.com/some/path?x=1", {
      redirect: "manual",
    });
    const location = comRes.headers.get("location");
    record(
      `theallodium.com redirects to ${SITE_URL} (301, path + query string preserved)`,
      comRes.status === 301 && location === `${SITE_URL}/some/path?x=1`,
      `status=${comRes.status}, location=${location}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  mkdirSync("evidence", { recursive: true });
  const evidencePath = resolve(`evidence/smoke-live-${Date.now()}.json`);
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
