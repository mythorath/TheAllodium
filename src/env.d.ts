/** Ambient Cloudflare bindings for local typecheck before `wrangler types`. */
interface CloudflareBindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ABSTRACT_SEARCH_ENABLED?: string;
  OG_CARDS: R2Bucket;
  GPU_ORIGIN?: string;
  GPU_SHARED_SECRET?: string;
  AUTHORITY?: D1Database;
  SEARCH_CACHE?: KVNamespace;
  UPSTREAM_RATE_LIMITER?: DurableObjectNamespace;
  FEDERATION_CONTACT_EMAIL?: string;
}
