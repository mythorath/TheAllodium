import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      // e2e/ is a separate Playwright suite (real browser + axe-core) run
      // via `npm run test:e2e`, not compatible with the Workers pool
      // runtime's restrictions on global-scope async I/O.
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/e2e/**",
      ],
      setupFiles: ["./tests/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              ABSTRACT_SEARCH_ENABLED: "0",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
