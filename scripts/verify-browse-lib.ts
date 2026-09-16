import { normalizeDoi } from "../src/federation/identity";
import { SITE_URL } from "../src/site-config";

export const DEFAULT_VERIFY_ORIGIN =
  "https://theallodium-staging.theallodium.workers.dev";
export const DEFAULT_STATE_DIR = "/mnt/smesh/allodium-verify/";
export const DOI_QUEUE_FILENAME = "doi-queue.jsonl";
export const HUB_PAGES_FILENAME = "hub-pages.jsonl";
export const FORBIDDEN_PASS_A_PREFIXES = ["/partials/works", "/api/search"] as const;

export type HubRecord = {
  url: string;
  status: number;
  error?: string;
  checked_at: string;
};

export type DoiQueueRecord = {
  doi: string;
  http_status: number;
  title?: string;
  resolved_at: string;
};

export type HubVerdict = "ok" | "expected-redirect" | "failure";

export function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export function parseLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  for (const match of xml.matchAll(re)) {
    locs.push(decodeXml(match[1].trim()));
  }
  return locs;
}

export function rewriteLoc(
  loc: string,
  targetOrigin: string,
  canonicalOrigin = SITE_URL,
): string {
  const trimmed = loc.trim();
  const canonical = canonicalOrigin.replace(/\/$/, "");
  const target = targetOrigin.replace(/\/$/, "");
  if (trimmed.startsWith(canonical)) {
    return `${target}${trimmed.slice(canonical.length)}`;
  }
  return trimmed;
}

export function extractHrefValues(html: string): string[] {
  const values: string[] = [];
  const re = /\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(re)) {
    values.push(decodeHtmlEntities(match[1]));
  }
  return values;
}

export function doiFromWorksHref(href: string, pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/works\/(.+)$/);
  if (!match) return null;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep the path segment as-is when it is not valid percent-encoding.
  }
  return normalizeDoi(raw);
}

export function extractWorksDois(html: string, pageUrl: string): string[] {
  const dois: string[] = [];
  const seen = new Set<string>();
  for (const href of extractHrefValues(html)) {
    const doi = doiFromWorksHref(href, pageUrl);
    if (doi && !seen.has(doi)) {
      seen.add(doi);
      dois.push(doi);
    }
  }
  return dois;
}

export function extractH1(html: string): string | undefined {
  const match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (!match) return undefined;
  const title = decodeHtmlEntities(match[1]).trim();
  return title.length > 0 ? title : undefined;
}

export function isForbiddenPassAUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return FORBIDDEN_PASS_A_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
    );
  } catch {
    return false;
  }
}

export function classifyHubStatus(url: string, status: number): HubVerdict {
  if (status === 200 || status === 304) return "ok";
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return "failure";
  }
  if ((status === 301 || status === 302) && (path === "/issn" || path.startsWith("/issn/"))) {
    return "expected-redirect";
  }
  return "failure";
}

export function extractOriginalPaperDoisFromSql(sql: string): string[] {
  const dois: string[] = [];
  const insertRe =
    /INSERT\s+INTO\s+retraction_watch_notices\b[\s\S]*?VALUES\s*([\s\S]*?);/gi;
  for (const insert of sql.matchAll(insertRe)) {
    const values = insert[1];
    const rowRe =
      /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g;
    for (const row of values.matchAll(rowRe)) {
      const original = row[3].replace(/''/g, "'").trim();
      const doi = normalizeDoi(original);
      if (doi) dois.push(doi);
    }
  }
  return [...new Set(dois)];
}

export function worksPath(doi: string): string {
  return `/works/${encodeURIComponent(doi)}`;
}

export function parseJsonlRecords<T>(text: string): T[] {
  const records: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed) as T);
  }
  return records;
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export type BrowseVerifyOptions = {
  origin: string;
  fetchImpl: typeof fetch;
  retractionDois?: readonly string[];
  passA?: boolean;
  passB?: boolean;
  passAConcurrency?: number;
  passBConcurrency?: number;
  delayMs?: number;
  passBDelayMs?: number;
  maxHubs?: number;
  maxDois?: number;
  maxHubFailures?: number;
  maxResolveFailures?: number;
  doneHubs?: Set<string>;
  doneDois?: Set<string>;
  onHub?: (record: HubRecord) => void | Promise<void>;
  onDoi?: (record: DoiQueueRecord) => void | Promise<void>;
  now?: () => string;
};

export type BrowseVerifyResult = {
  hubOk: number;
  hubRedirect: number;
  hubFailure: number;
  doisResolved: number;
  doisFailed: number;
  dois: DoiQueueRecord[];
  hubs: HubRecord[];
  fetchedUrls: string[];
  exitCode: number;
};

function originOf(value: string): string {
  return value.replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readText(
  fetchImpl: typeof fetch,
  url: string,
  fetchedUrls: string[],
): Promise<{ status: number; body: string; error?: string }> {
  fetchedUrls.push(url);
  try {
    const response = await fetchImpl(url, {
      redirect: "manual",
      headers: { "user-agent": "TheAllodium-verify-browse/0.1" },
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 0, body: "", error: message };
  }
}

export async function runBrowseVerification(
  options: BrowseVerifyOptions,
): Promise<BrowseVerifyResult> {
  const origin = originOf(options.origin);
  const fetchImpl = options.fetchImpl;
  const passA = options.passA !== false;
  const passB = options.passB !== false;
  const now = options.now ?? (() => new Date().toISOString());
  const doneHubs = options.doneHubs ?? new Set<string>();
  const doneDois = options.doneDois ?? new Set<string>();
  const fetchedUrls: string[] = [];
  const hubs: HubRecord[] = [];
  const doisFromHtml = new Set<string>();
  let hubOk = 0;
  let hubRedirect = 0;
  let hubFailure = 0;

  if (passA) {
    const indexUrl = `${origin}/sitemap.xml`;
    if (isForbiddenPassAUrl(indexUrl)) {
      throw new Error(`Pass A must not fetch ${indexUrl}`);
    }
    const index = await readText(fetchImpl, indexUrl, fetchedUrls);
    if (index.status !== 200) {
      throw new Error(`sitemap index returned HTTP ${index.status}`);
    }
    const childLocs = parseLocs(index.body).map((loc) => rewriteLoc(loc, origin));
    const hubLocs: string[] = [];
    for (const child of childLocs) {
      if (isForbiddenPassAUrl(child)) {
        throw new Error(`Pass A must not fetch ${child}`);
      }
      const childPage = await readText(fetchImpl, child, fetchedUrls);
      if (childPage.status !== 200) {
        throw new Error(`sitemap child ${child} returned HTTP ${childPage.status}`);
      }
      for (const loc of parseLocs(childPage.body)) {
        hubLocs.push(rewriteLoc(loc, origin));
      }
    }
    const limited = options.maxHubs !== undefined ? hubLocs.slice(0, options.maxHubs) : hubLocs;
    const pending = limited.filter((url) => !doneHubs.has(url));
    await mapPool(pending, options.passAConcurrency ?? 4, async (url) => {
      if (isForbiddenPassAUrl(url)) {
        throw new Error(`Pass A must not fetch ${url}`);
      }
      if (options.delayMs) await sleep(options.delayMs);
      const page = await readText(fetchImpl, url, fetchedUrls);
      const record: HubRecord = {
        url,
        status: page.status,
        checked_at: now(),
      };
      if (page.error) record.error = page.error;
      const verdict = classifyHubStatus(url, page.status);
      if (verdict === "ok") hubOk += 1;
      else if (verdict === "expected-redirect") hubRedirect += 1;
      else hubFailure += 1;
      if (verdict !== "failure" && page.body) {
        for (const doi of extractWorksDois(page.body, url)) {
          doisFromHtml.add(doi);
        }
      }
      hubs.push(record);
      doneHubs.add(url);
      await options.onHub?.(record);
      return record;
    });
  }

  const retractionDois = (options.retractionDois ?? [])
    .map((doi) => normalizeDoi(doi))
    .filter((doi): doi is string => doi !== null);
  const allDois = [...new Set([...retractionDois, ...doisFromHtml])];
  const limitedDois =
    options.maxDois !== undefined ? allDois.slice(0, options.maxDois) : allDois;
  const doiRecords: DoiQueueRecord[] = [];
  let doisResolved = 0;
  let doisFailed = 0;

  if (passB) {
    const pendingDois = limitedDois.filter((doi) => !doneDois.has(doi));
    await mapPool(pendingDois, options.passBConcurrency ?? 1, async (doi) => {
      if (options.passBDelayMs) await sleep(options.passBDelayMs);
      const url = `${origin}${worksPath(doi)}`;
      const page = await readText(fetchImpl, url, fetchedUrls);
      const record: DoiQueueRecord = {
        doi,
        http_status: page.status,
        resolved_at: now(),
      };
      if (page.status === 200) {
        const title = extractH1(page.body);
        if (title) record.title = title;
        doisResolved += 1;
      } else {
        doisFailed += 1;
      }
      doiRecords.push(record);
      doneDois.add(doi);
      await options.onDoi?.(record);
      return record;
    });
  }

  const maxHubFailures = options.maxHubFailures ?? 0;
  const maxResolveFailures = options.maxResolveFailures ?? Number.MAX_SAFE_INTEGER;
  let exitCode = 0;
  if (hubFailure > maxHubFailures) exitCode = 1;
  if (doisFailed > maxResolveFailures) exitCode = 1;

  return {
    hubOk,
    hubRedirect,
    hubFailure,
    doisResolved,
    doisFailed,
    dois: doiRecords,
    hubs,
    fetchedUrls,
    exitCode,
  };
}
