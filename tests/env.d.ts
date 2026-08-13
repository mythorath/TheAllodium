declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ASSETS?: Fetcher;
    ABSTRACT_SEARCH_ENABLED?: string;
    OG_CARDS: R2Bucket;
    GPU_ORIGIN?: string;
    GPU_SHARED_SECRET?: string;
    TEST_MIGRATIONS?: D1Migration[];
  }
}
