/** Ambient Cloudflare bindings for local typecheck before `wrangler types`. */
interface CloudflareBindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ABSTRACT_SEARCH_ENABLED?: string;
}
