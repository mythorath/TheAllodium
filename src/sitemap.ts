import type { SitemapKind, TaxonomyDomain } from "./authority/types";
import {
  countDoajSubjects,
  countOrganizations,
  countPublishers,
  countRetractionNotices,
  countSharedKeywords,
  countVenues,
  listOrganizationIdsPage,
  listPublisherIdsPage,
  listRetractionIdsPage,
  listSharedKeywordPage,
  listSubjectPage,
  listTaxonomyHierarchy,
  listVenueIdsPage,
  SITEMAP_PAGE_SIZE,
} from "./authority/repository";
import { countEntries, listEntriesForSitemapPage } from "./db/repository";
import {
  fieldsPath,
  keywordPath,
  organizationPath,
  publisherPath,
  retractionPath,
  subjectPath,
  venuePath,
} from "./open-index/paths";
import { SITE_URL } from "./site-config";

export type SitemapUrl = {
  path: string;
  lastmod?: string | null;
};

export { SITEMAP_PAGE_SIZE };

export const SITEMAP_KINDS: readonly SitemapKind[] = [
  "static",
  "fields",
  "keywords",
  "venues",
  "publishers",
  "organizations",
  "subjects",
  "retractions",
  "entries",
];

/** Static routes with no per-row D1 source of truth for their own existence. */
export const STATIC_SITEMAP_PATHS: readonly string[] = [
  "/",
  "/psychotherapy",
  "/psychotherapy/search",
  "/psychotherapy/topics",
  "/psychotherapy/hexaflex",
  "/psychotherapy/disclaimer",
  "/standard",
  "/about",
  "/support",
  "/open-index",
  "/search",
  "/coverage",
  "/fields",
  "/keywords",
  "/venues",
  "/publishers",
  "/organizations",
  "/subjects",
  "/retractions",
  "/retractions/reasons",
];

export function isSitemapKind(value: string): value is SitemapKind {
  return (SITEMAP_KINDS as readonly string[]).includes(value);
}

export function taxonomySitemapPaths(domains: TaxonomyDomain[]): string[] {
  const paths: string[] = [];
  for (const domain of domains) {
    const domainPath = fieldsPath(domain.id);
    paths.push(domainPath);
    for (const field of domain.fields) {
      const fieldPath = fieldsPath(domain.id, field.id);
      paths.push(fieldPath);
      for (const subfield of field.subfields) {
        const subfieldPath = fieldsPath(domain.id, field.id, subfield.id);
        paths.push(subfieldPath);
        for (const topic of subfield.topics) {
          paths.push(fieldsPath(domain.id, field.id, subfield.id, topic.id));
        }
      }
    }
  }
  return paths;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSitemapXml(urls: SitemapUrl[]): string {
  const entries = urls
    .map((u) => {
      const loc = xmlEscape(`${SITE_URL}${u.path}`);
      const lastmod = u.lastmod ? `\n    <lastmod>${xmlEscape(u.lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export function buildSitemapIndexXml(childPaths: string[]): string {
  const entries = childPaths
    .map((path) => `  <sitemap>\n    <loc>${xmlEscape(`${SITE_URL}${path}`)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

function childPages(kind: SitemapKind, total: number): string[] {
  if (total <= 0) return kind === "static" ? [`/sitemaps/${kind}/0.xml`] : [];
  const count = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
  return Array.from({ length: count }, (_, page) => `/sitemaps/${kind}/${page}.xml`);
}

export async function listSitemapIndexPaths(
  db: D1Database,
  authority: D1Database | undefined,
): Promise<string[]> {
  const entryCount = await countEntries(db);
  const paths = [
    ...childPages("static", Math.max(1, STATIC_SITEMAP_PATHS.length)),
    ...childPages("entries", entryCount),
  ];
  if (!authority) return paths;
  try {
    const [venues, publishers, organizations, retractions, keywords, subjects, taxonomy] =
      await Promise.all([
        countVenues(authority),
        countPublishers(authority),
        countOrganizations(authority),
        countRetractionNotices(authority),
        countSharedKeywords(authority),
        countDoajSubjects(authority),
        listTaxonomyHierarchy(authority),
      ]);
    const fieldPaths = taxonomySitemapPaths(taxonomy);
    paths.push(
      ...childPages("fields", fieldPaths.length),
      ...childPages("keywords", keywords),
      ...childPages("venues", venues),
      ...childPages("publishers", publishers),
      ...childPages("organizations", organizations),
      ...childPages("subjects", subjects),
      ...childPages("retractions", retractions),
    );
  } catch {
    // An unloaded or pre-migration authority binding omits browse sitemaps.
  }
  return paths;
}

export async function buildSitemapChild(
  kind: SitemapKind,
  page: number,
  db: D1Database,
  authority: D1Database | undefined,
): Promise<SitemapUrl[] | null> {
  switch (kind) {
    case "static":
      if (page !== 0) return null;
      return STATIC_SITEMAP_PATHS.map((path) => ({ path }));
    case "entries": {
      const rows = await listEntriesForSitemapPage(db, page, SITEMAP_PAGE_SIZE);
      if (!rows || (page > 0 && rows.length === 0)) return null;
      return rows.map((row) => ({
        path: `/psychotherapy/entries/${row.id}`,
        lastmod: row.updated_at,
      }));
    }
    case "fields": {
      if (!authority) return page === 0 ? [] : null;
      const taxonomy = await listTaxonomyHierarchy(authority);
      const paths = taxonomySitemapPaths(taxonomy);
      const start = page * SITEMAP_PAGE_SIZE;
      if (page > 0 && start >= paths.length) return null;
      return paths.slice(start, start + SITEMAP_PAGE_SIZE).map((path) => ({ path }));
    }
    case "keywords": {
      if (!authority) return null;
      const ids = await listSharedKeywordPage(authority, page, SITEMAP_PAGE_SIZE);
      if (!ids || (page > 0 && ids.length === 0)) return null;
      return ids.map((keyword) => ({ path: keywordPath(keyword) }));
    }
    case "venues": {
      if (!authority) return null;
      const ids = await listVenueIdsPage(authority, page, SITEMAP_PAGE_SIZE);
      if (!ids || (page > 0 && ids.length === 0)) return null;
      return ids.map((id) => ({ path: venuePath(id) }));
    }
    case "publishers": {
      if (!authority) return null;
      const ids = await listPublisherIdsPage(authority, page, SITEMAP_PAGE_SIZE);
      if (!ids || (page > 0 && ids.length === 0)) return null;
      return ids.map((id) => ({ path: publisherPath(id) }));
    }
    case "organizations": {
      if (!authority) return null;
      const ids = await listOrganizationIdsPage(authority, page, SITEMAP_PAGE_SIZE);
      if (!ids || (page > 0 && ids.length === 0)) return null;
      return ids.map((id) => ({ path: organizationPath(id) }));
    }
    case "subjects": {
      if (!authority) return null;
      const ids = await listSubjectPage(authority, page, SITEMAP_PAGE_SIZE);
      if (!ids || (page > 0 && ids.length === 0)) return null;
      return ids.map((subject) => ({ path: subjectPath(subject) }));
    }
    case "retractions": {
      if (!authority) return null;
      const ids = await listRetractionIdsPage(authority, page, SITEMAP_PAGE_SIZE);
      if (!ids || (page > 0 && ids.length === 0)) return null;
      return ids.map((id) => ({ path: retractionPath(id) }));
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
