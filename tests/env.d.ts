declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ASSETS?: Fetcher;
    ABSTRACT_SEARCH_ENABLED?: string;
    TEST_MIGRATIONS?: D1Migration[];
  }
}
