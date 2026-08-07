import { SITE_URL } from "./site-config";

export type SitemapUrl = {
  path: string;
  lastmod?: string | null;
};

/** Static routes with no per-row D1 source of truth for their own existence. */
export const STATIC_SITEMAP_PATHS: readonly string[] = [
  "/",
  "/psychotherapy/search",
  "/standard",
  "/disclaimer",
];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Renders a single-file `urlset` sitemap. 5,643 entries plus a handful of
 * static routes sits well under the 50,000-URL single-sitemap limit, so no
 * sitemap index is needed. Built live from D1 on every request (cached at
 * the edge via Cache-Control) rather than baked into a static file at
 * deploy time, consistent with this project's D1-is-source-of-truth design
 * — a snapshot promotion is reflected without needing a redeploy.
 */
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
