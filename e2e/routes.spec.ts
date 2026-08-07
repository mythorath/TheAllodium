import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase 1E accessibility/route/search smoke suite. Runs against the local
 * dev Worker (see playwright.config.ts) backed by the local D1 loaded via
 * `npm run db:reset:local` -- the same spike fixture the Vitest suite uses,
 * so ids/queries below are the same known-good synthetic data (see
 * fixtures/spike_fixture.sql). Real multi-page pagination against the full
 * 5,643-row corpus is proven separately in tests/full-snapshot.test.ts,
 * since the small local fixture never exceeds one page of results.
 *
 * Each route gets an axe-core scan asserting zero serious/critical
 * violations, plus assertions on the route's actual content/behavior.
 */

async function expectNoSeriousA11yViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious,
    JSON.stringify(serious, null, 2),
  ).toEqual([]);
}

test.describe("home", () => {
  test("loads with live manifest stats and no serious a11y violations", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/The Allodium/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "The Allodium",
    );
    await expect(page.getByText(/entries across/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open keyword search" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("skip link targets the main landmark", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await expect(skipLink).toHaveAttribute("href", "#main");
    await expect(page.locator("main#main")).toBeVisible();
  });
});

test.describe("search", () => {
  test("prompts for a query when none is given", async ({ page }) => {
    await page.goto("/psychotherapy/search");
    await expect(
      page.getByText("Enter a keyword to search the public index."),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("returns results for a known query and labels blocked links", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?q=trauma");
    await expect(
      page.getByRole("link", { name: "Trauma-Focused CBT Overview" }),
    ).toBeVisible();
    await expect(page.getByText("link inconclusive")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("shows an explicit empty state for a query with zero hits", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?q=zzzznoresultsxyz");
    await expect(page.getByText(/No results for/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("search form has an accessible, labeled input", async ({ page }) => {
    await page.goto("/psychotherapy/search");
    const input = page.getByLabel("Search query");
    await expect(input).toBeVisible();
    await input.fill("values");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=values/);
  });
});

test.describe("entries", () => {
  test("serves a canonical entry with verification records", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/aaaaaaaa00000001");
    await expect(
      page.getByRole("heading", { name: "Values Clarification Worksheet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Verification" }),
    ).toBeVisible();
    await expect(page.getByText("keep via qwen3.6:35b")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("redirects a retired alias id to its canonical entry", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/retired000000001");
    await expect(page).toHaveURL(/\/psychotherapy\/entries\/aaaaaaaa00000001$/);
  });

  test("shows a 404 page for an unknown entry id", async ({ page }) => {
    const response = await page.goto(
      "/psychotherapy/entries/doesnotexist0000",
    );
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("standard and disclaimer", () => {
  test("/standard explains the verification methodology with live coverage", async ({
    page,
  }) => {
    await page.goto("/standard");
    await expect(
      page.getByRole("heading", { name: "The Standard", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Identity check", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Legitimacy triage", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Link health", { exact: true }).first(),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("/disclaimer carries crisis routing and links from every page footer", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: "Disclaimer & crisis resources" })
      .click();
    await expect(page).toHaveURL(/\/disclaimer$/);
    await expect(page.getByText("988")).toBeVisible();
    await expect(page.getByText("findahelpline.com")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("generic 404", () => {
  test("unknown routes render the not-found page", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
