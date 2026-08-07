/** Phase 1F: single source of truth for absolute site URLs — canonical
 * links, JSON-LD, and the sitemap all derive from this so they can never
 * drift from the deployed domain. */
export const SITE_URL = "https://theallodium.org" as const;
