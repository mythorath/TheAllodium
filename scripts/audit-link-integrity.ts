import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags } from "./cli";
import { remoteQuery, sqlString } from "./smoke-checks";
import { SITE_URL } from "../src/site-config";
import { SORT_OPTIONS } from "../src/db/sort";
import type { SortOption } from "../src/db/sort";

config();

/**
 * Real HTTP-level link-integrity audit, complementing `smoke-live.ts`
 * (structural checks) and `smoke-checks.ts` (D1-level data checks). Exists
 * specifically to catch the class of bug that unit tests against a single
 * local D1 connection can't: an entry's rendered id/title/canonical_url
 * drifting between two requests to the *live, deployed* edge (a different
 * read path, a reload after a promotion, tied sort keys resolving
 * differently) -- see the plan this implements for the full writeup of the
 * `sortOrderBy()` missing-tiebreaker bug this was built to catch and guard
 * against regressing.
 */

function usage(): never {
  throw new Error(
    "Usage: audit-link-integrity.ts --url <base-url> [--env staging|production] [--sample <n>]\n" +
      `  e.g. --url ${SITE_URL} --env production\n` +
      "  --env enables direct D1 source-of-truth cross-checks (via `wrangler d1 execute --remote`)\n" +
      "  against every duplicate-titled ('tie-risk') entry, on top of the pure-HTTP checks that always run.\n" +
      "  --sample controls how many additional random entry ids get the double-fetch check (default 40).",
  );
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const MAX_PAGES_TO_WALK = 20;
const PAGE_SIZE = 25; // must match src/db/repository.ts's PAGE_SIZE

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

interface ParsedEntryPage {
  id: string | null;
  title: string | null;
  canonicalUrl: string | null;
  jsonLdUrl: string | null;
  jsonLdMainEntityUrl: string | null;
}

function parseEntryPage(html: string): ParsedEntryPage {
  const idMatch = html.match(/<dt>ID<\/dt>\s*<dd>\s*<code>([^<]*)<\/code>/);
  const titleMatch = html.match(/<h1>([^<]*)<\/h1>/);
  const sourceMatch = html.match(/<a\s+class="button-primary"\s+href="([^"]*)"/);
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/);
  let jsonLdUrl: string | null = null;
  let jsonLdMainEntityUrl: string | null = null;
  if (jsonLdMatch) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1]) as { url?: string; mainEntity?: { url?: string } };
      jsonLdUrl = parsed.url ?? null;
      jsonLdMainEntityUrl = parsed.mainEntity?.url ?? null;
    } catch {
      // Malformed JSON-LD is its own bug, but not what this check is for --
      // leave both null so the mismatch surfaces via the other assertions.
    }
  }
  return {
    id: idMatch ? decodeHtmlEntities(idMatch[1]) : null,
    title: titleMatch ? decodeHtmlEntities(titleMatch[1]) : null,
    canonicalUrl: sourceMatch ? decodeHtmlEntities(sourceMatch[1]) : null,
    jsonLdUrl,
    jsonLdMainEntityUrl,
  };
}

interface ParsedSearchPage {
  ids: string[];
  page: number | null;
  totalPages: number | null;
}

function parseSearchPage(html: string): ParsedSearchPage {
  const ids = Array.from(
    html.matchAll(/<a href="\/psychotherapy\/entries\/([a-zA-Z0-9]+)">/g),
  ).map((m) => m[1]);
  const pageMatch = html.match(/page (\d+)\/(\d+)/);
  return {
    ids,
    page: pageMatch ? Number(pageMatch[1]) : null,
    totalPages: pageMatch ? Number(pageMatch[2]) : null,
  };
}

interface FacetOption {
  value: string;
  count: number;
}

function parseFacetOptions(html: string, paramName: string): FacetOption[] {
  const re = new RegExp(
    `<input\\s+type="checkbox"\\s+name="${paramName}"\\s+value="([^"]+)"[^>]*/>\\s*([^(]*)\\(([\\d,]+)\\)`,
    "g",
  );
  return Array.from(html.matchAll(re)).map((m) => ({
    value: m[1],
    count: Number(m[3].replace(/,/g, "")),
  }));
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2));
  const base = flags.url?.replace(/\/$/, "");
  if (!base) usage();
  const env = flags.env;
  if (env !== undefined && env !== "staging" && env !== "production") usage();
  const sampleSize = flags.sample ? Number(flags.sample) : 40;

  const results: CheckResult[] = [];
  function record(name: string, ok: boolean, detail?: string) {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `, ${detail}` : ""}`);
  }

  console.log(`Auditing link integrity for ${base}${env ? ` (env=${env})` : ""}…\n`);

  console.log("Enumerating every entry id from the live entries sitemap…");
  const sitemapRes = await fetch(`${base}/sitemaps/entries/0.xml`);
  record("GET /sitemaps/entries/0.xml -> 200", sitemapRes.status === 200, `status=${sitemapRes.status}`);
  const sitemapXml = await sitemapRes.text();
  const allIds = Array.from(
    sitemapXml.matchAll(/\/psychotherapy\/entries\/([a-zA-Z0-9]+)/g),
  ).map((m) => m[1]);
  record("sitemap.xml lists at least one entry", allIds.length > 0, `count=${allIds.length}`);

  // --- D1 source-of-truth discovery (only with --env) -----------------
  const riskIds = new Set<string>();
  const sourceOfTruth = new Map<string, { title: string; canonical_url: string }>();
  if (env) {
    console.log(`\n[${env}] querying D1 for tie-risk ids (duplicate titles)…`);
    const tiedTitles = remoteQuery(env, `SELECT title FROM entries GROUP BY title HAVING COUNT(*) > 1;`);
    for (const row of tiedTitles.rows) {
      const title = (row as { title: string }).title;
      const rowsForTitle = remoteQuery(env, `SELECT id FROM entries WHERE title = ${sqlString(title)};`);
      for (const idRow of rowsForTitle.rows) riskIds.add((idRow as { id: string }).id);
    }
    record(
      "discovered tie-risk ids from duplicate-titled entries in D1",
      true,
      `duplicateTitleGroups=${tiedTitles.rows.length}, riskIds=${riskIds.size}`,
    );
  }

  const shuffled = [...allIds].sort(() => Math.random() - 0.5);
  const sampleIds = Array.from(new Set([...riskIds, ...shuffled.slice(0, sampleSize)]));

  if (env && sampleIds.length > 0) {
    const placeholders = sampleIds.map((id) => sqlString(id)).join(", ");
    const rows = remoteQuery(env, `SELECT id, title, canonical_url FROM entries WHERE id IN (${placeholders});`);
    for (const row of rows.rows) {
      const r = row as { id: string; title: string; canonical_url: string };
      sourceOfTruth.set(r.id, { title: r.title, canonical_url: r.canonical_url });
    }
  }

  // --- Per-entry double-fetch self-consistency -------------------------
  console.log(
    `\nDouble-fetching ${sampleIds.length} entry pages (${riskIds.size} known tie-risk + up to ${sampleSize} random)…`,
  );
  let entryMismatches = 0;
  for (const id of sampleIds) {
    const [firstRes, secondRes] = await Promise.all([
      fetch(`${base}/psychotherapy/entries/${id}`),
      fetch(`${base}/psychotherapy/entries/${id}`),
    ]);
    const [firstHtml, secondHtml] = await Promise.all([firstRes.text(), secondRes.text()]);
    const first = parseEntryPage(firstHtml);
    const second = parseEntryPage(secondHtml);
    const truth = sourceOfTruth.get(id);

    const problems: string[] = [];
    if (firstRes.status !== 200 || secondRes.status !== 200) {
      problems.push(`status ${firstRes.status}/${secondRes.status}`);
    }
    if (first.id !== id || second.id !== id) {
      problems.push(`rendered id mismatch: requested=${id} first=${first.id} second=${second.id}`);
    }
    if (first.canonicalUrl !== second.canonicalUrl) {
      problems.push(`canonical_url changed between fetches: ${first.canonicalUrl} vs ${second.canonicalUrl}`);
    }
    if (first.title !== second.title) {
      problems.push(`title changed between fetches: ${first.title} vs ${second.title}`);
    }
    if (first.jsonLdMainEntityUrl && first.jsonLdMainEntityUrl !== first.canonicalUrl) {
      problems.push(`JSON-LD mainEntity.url (${first.jsonLdMainEntityUrl}) != Open-source href (${first.canonicalUrl})`);
    }
    if (truth) {
      if (first.canonicalUrl !== truth.canonical_url) {
        problems.push(`canonical_url != D1 source of truth: page=${first.canonicalUrl} db=${truth.canonical_url}`);
      }
      if (first.title !== truth.title) {
        problems.push(`title != D1 source of truth: page=${first.title} db=${truth.title}`);
      }
    }

    if (problems.length > 0) {
      entryMismatches += 1;
      record(`entry ${id} is self-consistent${truth ? " and matches D1" : ""}`, false, problems.join("; "));
    }
  }
  record(
    `${sampleIds.length} sampled entry pages (incl. ${riskIds.size} known tie-risk ids) stayed self-consistent`,
    entryMismatches === 0,
    `mismatches=${entryMismatches}`,
  );

  // --- Discover a bounded facet value for pagination/order checks ------
  console.log("\nDiscovering a modality with a workable row count for pagination checks…");
  const landingRes = await fetch(`${base}/psychotherapy/search`);
  const landingHtml = await landingRes.text();
  const modalityOptions = parseFacetOptions(landingHtml, "modality");
  // Sweet spot: enough rows to span 2+ pages, few enough to walk every page
  // quickly. Falls back to the smallest modality bigger than one page, then
  // gives up gracefully (small/local datasets may have nothing this big).
  const bounded =
    modalityOptions
      .filter((o) => o.count > PAGE_SIZE && o.count <= PAGE_SIZE * MAX_PAGES_TO_WALK)
      .sort((a, b) => a.count - b.count)[0] ??
    modalityOptions.filter((o) => o.count > PAGE_SIZE).sort((a, b) => a.count - b.count)[0];

  if (!bounded) {
    console.warn(
      "  No modality with more than one page of results was found, skipping order-stability and pagination-completeness checks (dataset too small, e.g. a local dev fixture).",
    );
  } else {
    record("discovered a bounded modality for pagination checks", true, `modality=${bounded.value}, count=${bounded.count}`);

    async function fetchSearchIds(sort: SortOption, page: number): Promise<ParsedSearchPage> {
      const url = `${base}/psychotherapy/search?modality=${encodeURIComponent(bounded!.value)}&sort=${sort}&page=${page}`;
      const res = await fetch(url);
      return parseSearchPage(await res.text());
    }

    // fetch_search_documents() in export_allodium_snapshot.py always puts a
    // resource's modality string first in its indexed `meta` -- so
    // searching for the modality's own name is guaranteed to match every
    // row already in that modality, giving a reliable bounded FTS case too.
    async function fetchFtsIds(sort: SortOption, page: number): Promise<ParsedSearchPage> {
      const url = `${base}/psychotherapy/search?q=${encodeURIComponent(bounded!.value)}&modality=${encodeURIComponent(bounded!.value)}&sort=${sort}&page=${page}`;
      const res = await fetch(url);
      return parseSearchPage(await res.text());
    }

    for (const [modeName, fetcher] of [
      ["browse", fetchSearchIds],
      ["fts", fetchFtsIds],
    ] as const) {
      for (const sort of SORT_OPTIONS) {
        console.log(`\n[${modeName}] modality=${bounded.value} sort=${sort} …`);

        // 1. Order stability: fetch page 1 twice and diff the ordered id list.
        const [firstPage, secondPage] = await Promise.all([fetcher(sort, 1), fetcher(sort, 1)]);
        const orderStable = JSON.stringify(firstPage.ids) === JSON.stringify(secondPage.ids);
        record(
          `${modeName}/${sort} page 1 returns the same order on repeated identical requests`,
          orderStable,
          orderStable ? undefined : `first=${JSON.stringify(firstPage.ids)} second=${JSON.stringify(secondPage.ids)}`,
        );

        // 2. Pagination completeness: walk every page once, check for
        //    duplicates/gaps caused by ties shifting the OFFSET cut point.
        const totalPages = Math.min(firstPage.totalPages ?? 1, MAX_PAGES_TO_WALK);
        const collected = [...firstPage.ids];
        for (let page = 2; page <= totalPages; page++) {
          const result = await fetcher(sort, page);
          collected.push(...result.ids);
        }
        const uniqueCount = new Set(collected).size;
        const complete = uniqueCount === collected.length;
        record(
          `${modeName}/${sort} walks ${totalPages} page(s) with no duplicate ids`,
          complete,
          complete ? `ids=${collected.length}` : `collected=${collected.length} unique=${uniqueCount}`,
        );
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  mkdirSync("evidence", { recursive: true });
  const evidencePath = resolve(`evidence/audit-link-integrity-${Date.now()}.json`);
  writeFileSync(evidencePath, JSON.stringify({ at: new Date().toISOString(), base, env, results }, null, 2));
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
