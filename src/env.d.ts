/** Ambient Cloudflare bindings for local typecheck before `wrangler types`. */
interface CloudflareBindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ABSTRACT_SEARCH_ENABLED?: string;
  OG_CARDS: R2Bucket;
  GPU_ORIGIN?: string;
  GPU_SHARED_SECRET?: string;
}
