declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ASSETS?: Fetcher;
    ABSTRACT_SEARCH_ENABLED?: string;
    OG_CARDS: R2Bucket;
    GPU_ORIGIN?: string;
    GPU_SHARED_SECRET?: string;
    AUTHORITY?: D1Database;
    TEST_MIGRATIONS?: D1Migration[];
    TEST_AUTHORITY_MIGRATIONS?: D1Migration[];
  }
}
