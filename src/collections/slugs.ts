/** Path prefixes that contributed collections may not claim. */

export const RESERVED_COLLECTION_SLUGS = [
  "about",
  "api",
  "coverage",
  "disclaimer",
  "favicon.ico",
  "fields",
  "health",
  "issn",
  "keywords",
  "mcp",
  "og",
  "open-index",
  "organizations",
  "partials",
  "psychotherapy",
  "publishers",
  "retractions",
  "robots.txt",
  "search",
  "sitemaps",
  "standard",
  "subjects",
  "support",
  "venues",
  "works",
] as const;

export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_COLLECTION_SLUGS as readonly string[]).includes(slug);
}

export function assertCollectionSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid collection slug "${slug}": must match ${SLUG_PATTERN}`,
    );
  }
  if (isReservedSlug(slug)) {
    throw new Error(`Collection slug "${slug}" is reserved by the host`);
  }
}
