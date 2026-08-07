import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 1E: accessibility/route/search smoke suite. Runs against the real
 * Worker via `vite dev` (Cloudflare Vite plugin, Miniflare-backed), reusing
 * whatever local D1 fixture is loaded via `npm run db:reset:local` -- the
 * same spike fixture the Vitest suite exercises, so ids/queries here are
 * shared, known-good test data rather than invented per-suite fixtures.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
