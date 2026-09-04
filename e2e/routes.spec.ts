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
  test("welcomes visitors with a collection directory and no serious a11y violations", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/The Allodium/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "A place of free knowledge",
    );
    await expect(page.locator(".stat-strip")).toBeVisible();
    await expect(page.getByText("entries", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Psychotherapy" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Psychotherapy/ })).toHaveAttribute(
      "href",
      "/psychotherapy",
    );
    await expect(page.getByRole("heading", { name: "The Open Index" })).toBeVisible();
    await expect(page.getByRole("link", { name: /The Open Index/ })).toHaveAttribute(
      "href",
      "/open-index",
    );
    await expect(page.locator(".collection-card-planned")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Literature/ })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "How verification works" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Topics" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Disclaimer & crisis resources" }),
    ).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("open index doorway exposes search, fields, and coverage", async ({ page }) => {
    await page.goto("/open-index");
    await expect(page.getByRole("heading", { name: "Research across every field" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search all research" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the field map" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Coverage and blind spots" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto("/coverage");
    await expect(page.getByRole("heading", { name: "Coverage, including the gaps" })).toBeVisible();
    await expect(page.getByText("CNKI and Wanfang", { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("skip link targets the main landmark", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await expect(skipLink).toHaveAttribute("href", "#main");
    await expect(page.locator("main#main")).toBeVisible();
  });
});

test.describe("psychotherapy landing", () => {
  test("loads with live catalog doors, coverage, and collection chrome", async ({
    page,
  }) => {
    await page.goto("/psychotherapy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "A verified index of evidence",
    );
    await expect(page.locator(".stat-strip")).toBeVisible();
    await expect(page.getByRole("link", { name: /Literature/ })).toHaveAttribute(
      "href",
      "/psychotherapy/search?kind=literature",
    );
    await expect(page.getByRole("link", { name: /Materials/ })).toHaveAttribute(
      "href",
      "/psychotherapy/search?kind=materials",
    );
    await expect(
      page.getByRole("link", { name: "Search everything" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "How verification works" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What's excluded, and why" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Topics" }),
    ).toHaveAttribute("href", "/psychotherapy/topics");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Hexaflex" }),
    ).toHaveAttribute("href", "/psychotherapy/hexaflex");
    await expect(
      page.getByRole("navigation", { name: "Catalog" }).getByRole("link", { name: "Topics" }),
    ).toHaveAttribute("href", "/psychotherapy/topics");
    await expect(
      page.getByRole("navigation", { name: "Catalog" }).getByRole("link", { name: "Search" }),
    ).toHaveAttribute("href", "/psychotherapy/search");
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("directory landings (Phase 2.5C)", () => {
  test("topics page lists tags and a click starts a topic search", async ({ page }) => {
    await page.goto("/psychotherapy/topics");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Topics");
    await expectNoSeriousA11yViolations(page);
    await page.getByRole("link", { name: /depression/ }).click();
    await expect(page).toHaveURL(/\/psychotherapy\/search\?topic=depression$/);
    await expect(
      page.getByRole("link", {
        name: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
      }),
    ).toBeVisible();
  });

  test("hexaflex page links are materials-biased", async ({ page }) => {
    await page.goto("/psychotherapy/hexaflex");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hexaflex");
    await expect(page.getByRole("link", { name: /values/ })).toHaveAttribute(
      "href",
      "/psychotherapy/search?kind=materials&hexaflex=values",
    );
    await expectNoSeriousA11yViolations(page);
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("topics landing still lists search links", async ({ page }) => {
      await page.goto("/psychotherapy/topics");
      await expect(
        page.getByRole("link", { name: /depression/ }),
      ).toHaveAttribute("href", "/psychotherapy/search?topic=depression");
    });
  });
});

test.describe("search", () => {
  test("prompts to pick a corpus or type a keyword when none is given", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search");
    await expect(page.getByRole("group", { name: "Corpus" })).toBeVisible();
    await expect(page.getByLabel(/^All/)).toBeVisible();
    await expect(page.getByLabel(/^Literature/)).toBeVisible();
    await expect(page.getByLabel(/^Materials/)).toBeVisible();
    await expect(
      page.getByText(/or type a keyword to search both/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "literature", exact: true }),
    ).toHaveAttribute("href", "/psychotherapy/search?kind=literature");
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

  test("plain-language ask degrades to keyword results when the GPU is unset (Phase 3B)", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search");
    await page.getByLabel("Ask in plain language").fill("worksheets about values");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/assist=offline/);
    await expect(page).toHaveURL(/q=worksheets/);
    await expect(
      page.getByText("AI search assist is offline — showing keyword results."),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("crisis intent shows 988 copy and still searches (Phase 3B)", async ({ page }) => {
    await page.goto(
      "/psychotherapy/search?ask=" + encodeURIComponent("I want to kill myself"),
    );
    await expect(page).toHaveURL(/crisis=1/);
    await expect(page).not.toHaveURL(/ask=/);
    await expect(page.getByRole("heading", { name: "If you need help now" })).toBeVisible();
    await expect(page.getByText("988")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("sort control is available and citations sort ranks the most-cited hit first", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?q=depression");
    await expect(page.getByLabel("Sort by")).toBeVisible();

    await page.goto("/psychotherapy/search?q=depression&sort=citations_desc");
    await expect(page).toHaveURL(/sort=citations_desc/);
    await expect(page.getByLabel("Sort by")).toHaveValue("citations_desc");
    const first = page.locator(".result-list li a").first();
    await expect(first).toHaveText(
      "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
    );
  });
});

test.describe("faceted browse (Phase 2B)", () => {
  test("shows discoverable, labeled filter checkboxes on the empty landing page", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search");
    await expect(page.getByRole("group", { name: "Modality" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Access" })).toBeVisible();
    await expect(page.getByLabel("cbt (2)")).toBeVisible();
    await expect(page.getByLabel("Free to read (2)")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("browsing with a filter and no query is a first-class path, not the empty-query prompt", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?modality=cbt");
    await expect(page).toHaveURL(/modality=cbt/);
    await expect(
      page.getByText(/or type a keyword to search both/),
    ).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "Cognitive Restructuring Protocol" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Closed Access Psychotherapy Trial" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("combining a text query with a facet filter can legitimately return zero results", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?q=depression&audience=client");
    await expect(page.getByText(/No results for/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("Clear filters preserves the query but drops every facet param", async ({ page }) => {
    await page.goto("/psychotherapy/search?q=depression&audience=clinician");
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/q=depression/);
    await expect(page).not.toHaveURL(/audience=/);
  });

  test("kind=materials browses without a keyword and shows audience on result rows", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?kind=materials");
    await expect(page).toHaveURL(/kind=materials/);
    await expect(
      page.getByText(/or type a keyword to search both/),
    ).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "Values Clarification Worksheet" }),
    ).toBeVisible();
    await expect(
      page.locator(".result-list li", { hasText: "Values Clarification Worksheet" }).locator(".meta"),
    ).toContainText("client");
    await expectNoSeriousA11yViolations(page);
  });

  test("Clear filters keeps kind and drops the other facet params", async ({ page }) => {
    await page.goto("/psychotherapy/search?kind=literature&audience=client");
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/kind=literature/);
    await expect(page).not.toHaveURL(/audience=/);
  });

  test("empty landing shows Topic and Hexaflex but not Type or Decade (Phase 2.5B)", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search");
    await expect(page.getByRole("group", { name: "Topic" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Hexaflex" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Type" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Decade" })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("kind=materials shows Type and hides Decade; literature is the reverse", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?kind=materials");
    await expect(page.getByRole("group", { name: "Type" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Decade" })).toHaveCount(0);

    await page.goto("/psychotherapy/search?kind=literature");
    await expect(page.getByRole("group", { name: "Decade" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Type" })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("Clear filters from kind+topic keeps kind and drops topic", async ({ page }) => {
    await page.goto("/psychotherapy/search?kind=literature&topic=depression");
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/kind=literature/);
    await expect(page).not.toHaveURL(/topic=/);
  });

  test("facet checkboxes auto-submit with JavaScript (Phase 2.5D)", async ({ page }) => {
    await page.goto("/psychotherapy/search");
    await expect(page.locator('input[name="modality"][value="cbt"]')).toHaveAttribute(
      "data-auto-submit",
    );
    // HTMLFormElement.submit() (app.js) does not fire a submit event, so
    // Playwright's check()/click() navigation wait never settles. Drive the
    // change from the page, then wait on location.search directly. (String
    // bodies, not typed callbacks, since this project's tsconfig has no DOM
    // lib — these run in the browser, not under our Node types.)
    await page.evaluate(
      `document.querySelector('input[name="modality"][value="cbt"]').checked = true;
       document.querySelector('input[name="modality"][value="cbt"]')
         .dispatchEvent(new Event("change", { bubbles: true }));`,
    );
    await page.waitForFunction(`/modality=cbt/.test(location.search)`);
    await expect(
      page.getByRole("link", { name: "Cognitive Restructuring Protocol" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("kind browse still lists results", async ({ page }) => {
      await page.goto("/psychotherapy/search?kind=materials");
      await expect(
        page.getByRole("link", { name: "Values Clarification Worksheet" }),
      ).toBeVisible();
    });

    test("checking a facet still requires Search", async ({ page }) => {
      await page.goto("/psychotherapy/search");
      await page.getByLabel("cbt (2)").check();
      await expect(page).not.toHaveURL(/modality=cbt/);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/modality=cbt/);
      await expect(
        page.getByRole("link", { name: "Cognitive Restructuring Protocol" }),
      ).toBeVisible();
    });
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
      page.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    await expect(
      page.getByText("AI-generated summary — not a substitute for reading the source."),
    ).toBeVisible();
    await expect(
      page.getByText("helps people name personal values", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Verification" }),
    ).toBeVisible();
    await expect(page.getByText("keep via qwen3.6:35b")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("omits the Overview section when an entry has no overview", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/aaaaaaaa00000002");
    await expect(
      page.getByRole("heading", { name: "Defusion Techniques for Anxiety" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0);
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

  test("clicking a topic tag starts a fresh filtered search (Phase 2.5B)", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/bbbbbbbb00000003");
    await page.getByRole("link", { name: "depression", exact: true }).click();
    await expect(page).toHaveURL(/\/psychotherapy\/search\?topic=depression$/);
    await expect(
      page.getByRole("link", {
        name: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
      }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("topic tag href still filters search", async ({ page }) => {
      await page.goto("/psychotherapy/entries/bbbbbbbb00000003");
      await page.getByRole("link", { name: "depression", exact: true }).click();
      await expect(page).toHaveURL(/topic=depression/);
      await expect(
        page.getByRole("link", {
          name: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
        }),
      ).toBeVisible();
    });
  });
});

test.describe("citations and related entries (Phase 2C)", () => {
  test("shows a related entries block, and an honest empty state when none are computed", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/bbbbbbbb00000003");
    await expect(
      page.getByRole("heading", { name: "Related entries" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Behavioral Activation for Depression" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto("/psychotherapy/entries/dddddddd00000007");
    await expect(
      page.getByText("No related entries in this snapshot"),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("More like this opens a neighbors search (Phase 2.5D)", async ({ page }) => {
    await page.goto("/psychotherapy/entries/aaaaaaaa00000001");
    await page.getByRole("link", { name: "More like this" }).click();
    await expect(page).toHaveURL(/\/psychotherapy\/search\?like=aaaaaaaa00000001$/);
    await expect(
      page.getByRole("link", { name: "Defusion Techniques for Anxiety" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
      }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("renders BibTeX, RIS, and APA citations with a doi.org link", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/bbbbbbbb00000003");
    await expect(
      page.getByRole("heading", { name: "Cite this entry" }),
    ).toBeVisible();
    await expect(page.locator("#citation-bibtex")).toContainText(
      "@article{allodium:bbbbbbbb00000003",
    );
    await expect(page.locator("#citation-ris")).toContainText("TY  - JOUR");
    await expect(page.locator("#citation-apa")).toContainText(
      "Researcher, C., & Colleague, D.",
    );
    const doiLink = page.getByRole("link", {
      name: "https://doi.org/10.1000/act.depression.meta",
    });
    await expect(doiLink).toHaveAttribute(
      "href",
      "https://doi.org/10.1000/act.depression.meta",
    );
    await expectNoSeriousA11yViolations(page);
  });

  test("copying a citation writes the exact rendered text to the clipboard and shows feedback", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/psychotherapy/entries/bbbbbbbb00000003");

    const bibtexText = await page
      .locator("#citation-bibtex")
      .evaluate((el) => el.textContent);
    await page.getByRole("button", { name: "Copy BibTeX" }).click();
    await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toBe(bibtexText);
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("More like this href still works", async ({ page }) => {
      await page.goto("/psychotherapy/entries/aaaaaaaa00000001");
      await page.getByRole("link", { name: "More like this" }).click();
      await expect(page).toHaveURL(/like=aaaaaaaa00000001/);
      await expect(
        page.getByRole("link", { name: "Defusion Techniques for Anxiety" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", {
          name: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
        }),
      ).toBeVisible();
    });

    test("citation text stays fully visible and selectable, and the page never errors", async ({
      page,
    }) => {
      await page.goto("/psychotherapy/entries/bbbbbbbb00000003");
      await expect(page.locator("#citation-bibtex")).toContainText(
        "@article{allodium:bbbbbbbb00000003",
      );
      await expect(page.locator("#citation-ris")).toContainText("TY  - JOUR");
      await expect(page.locator("#citation-apa")).toContainText(
        "Researcher, C., & Colleague, D.",
      );
      // Copy buttons stay visible (inert without JS) rather than being
      // hidden — see the copy-script section of docs/phase-2c-decision-record.md
      // for why a <noscript> hide would itself violate the current CSP.
      await expect(
        page.getByRole("button", { name: "Copy BibTeX" }),
      ).toBeVisible();
    });
  });
});

test.describe("shortlists and print (Phase 2D)", () => {
  test("adding an entry to the shortlist toggles the button and updates the nav link", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/aaaaaaaa00000001");
    await expect(page.getByRole("link", { name: "Shortlist", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add to shortlist" }).click();
    await expect(page.getByRole("button", { name: "Remove from shortlist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Shortlist (1)" })).toBeVisible();

    await page.getByRole("button", { name: "Remove from shortlist" }).click();
    await expect(page.getByRole("button", { name: "Add to shortlist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Shortlist", exact: true })).toBeVisible();
  });

  test("shortlist items added from search results and an entry page accumulate into one shareable link", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/search?q=trauma");
    await page.getByRole("button", { name: "Add to shortlist" }).first().click();
    await expect(page.getByRole("link", { name: "Shortlist (1)" })).toBeVisible();

    await page.goto("/psychotherapy/entries/aaaaaaaa00000001");
    await page.getByRole("button", { name: "Add to shortlist" }).click();
    const shortlistLink = page.getByRole("link", { name: "Shortlist (2)" });
    await expect(shortlistLink).toBeVisible();
    await expect(shortlistLink).toHaveAttribute("href", /\/psychotherapy\/list\?ids=.+,.+/);

    await shortlistLink.click();
    await expect(page).toHaveURL(/\/psychotherapy\/list\?ids=/);
    await expect(
      page.getByRole("link", { name: "Trauma-Focused CBT Overview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Values Clarification Worksheet" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("a shared shortlist link renders its entries, and a Remove link needs no JS to work", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/list?ids=aaaaaaaa00000001,bbbbbbbb00000003");
    await expect(page.getByText("2 entries in this shortlist")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Values Clarification Worksheet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
      }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole("link", { name: "Remove from this shared list" }).first().click();
    await expect(page).toHaveURL(/\?ids=bbbbbbbb00000003$/);
    await expect(page.getByText("1 entry in this shortlist")).toBeVisible();
  });

  test("an empty shortlist prompts to build one, and unresolvable ids get an honest note", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/list");
    await expect(page.getByText("No items yet")).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto("/psychotherapy/list?ids=bbbbbbbb00000003,doesnotexist0000");
    await expect(page.getByText("1 entry in this shortlist", { exact: false })).toBeVisible();
    await expect(page.getByText(/could not be shown/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("whole-shortlist citation copy buttons copy the exact combined, multi-entry text", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/psychotherapy/list?ids=aaaaaaaa00000001,bbbbbbbb00000003");

    const bibtexText = await page
      .locator("#citation-bibtex")
      .evaluate((el) => el.textContent);
    expect(bibtexText).toContain("@misc{allodium:aaaaaaaa00000001,");
    expect(bibtexText).toContain("@article{allodium:bbbbbbbb00000003,");

    await page.getByRole("button", { name: "Copy BibTeX" }).click();
    await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(bibtexText);
  });

  test("print styles hide navigation, footer, and interactive buttons but keep citation content", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/bbbbbbbb00000003");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".site-nav")).toBeHidden();
    await expect(page.locator(".site-footer")).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy BibTeX" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Add to shortlist" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Cite this entry" })).toBeVisible();
    await expect(page.locator("#citation-bibtex")).toBeVisible();
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("a shared shortlist link fully round-trips, and Remove links (not Add-to-shortlist) work", async ({
      page,
    }) => {
      await page.goto("/psychotherapy/list?ids=aaaaaaaa00000001,bbbbbbbb00000003");
      await expect(page.getByText("2 entries in this shortlist")).toBeVisible();
      await expect(page.locator("#citation-bibtex")).toContainText(
        "@misc{allodium:aaaaaaaa00000001,",
      );
      await expect(page.locator("#citation-bibtex")).toContainText(
        "@article{allodium:bbbbbbbb00000003,",
      );
      // Add-to-shortlist buttons stay visible (inert without JS, same
      // pattern as the copy buttons) — building a list needs JS, but
      // reading/removing from an existing shared link never does.
      await expect(
        page.getByRole("button", { name: "Add to shortlist" }).first(),
      ).toBeVisible();

      await page.getByRole("link", { name: "Remove from this shared list" }).first().click();
      await expect(page).toHaveURL(/\?ids=bbbbbbbb00000003$/);
      await expect(page.getByText("1 entry in this shortlist")).toBeVisible();
    });
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
    await expect(
      page.getByRole("heading", { name: "Optional AI-assisted search" }),
    ).toBeVisible();
    await expect(page.getByText("qwen2.5:7b-instruct-q6_k")).toBeVisible();
    await expect(page.getByText("not therapy or clinical advice")).toBeVisible();
    await expect(page.getByText("988")).toBeVisible();
    await expect(page.getByRole("link", { name: /gpu-runbook/i })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("/psychotherapy/disclaimer carries crisis routing and links from collection footers", async ({
    page,
  }) => {
    await page.goto("/psychotherapy");
    await page
      .getByRole("link", { name: "Disclaimer & crisis resources" })
      .click();
    await expect(page).toHaveURL(/\/psychotherapy\/disclaimer$/);
    await expect(page.getByText("988")).toBeVisible();
    await expect(page.getByText("findahelpline.com")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("/disclaimer permanently redirects to /psychotherapy/disclaimer", async ({
    page,
  }) => {
    await page.goto("/disclaimer");
    await expect(page).toHaveURL(/\/psychotherapy\/disclaimer$/);
    await expect(page.getByRole("heading", { name: "Disclaimer" })).toBeVisible();
  });
});

test.describe("about", () => {
  test("/about is reachable from the primary nav and carries the mission copy", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "About" })
      .click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(
      page.getByRole("heading", { name: "Why The Allodium exists" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What you can count on" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "The Standard" }).first(),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("/about lists tip options with copyable wallet addresses", async ({
    page,
  }) => {
    await page.goto("/about");
    await expect(
      page.getByRole("heading", { name: "If you'd like to leave a tip" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Ko-fi" })).toHaveAttribute(
      "href",
      "https://ko-fi.com/mythorath",
    );
    await expect(page.locator("#support-address-0")).toContainText(
      "bc1qwlncslagx4cdacjgmvneqa9swnth5k9erjnsjn",
    );
    await expect(
      page.getByRole("button", { name: "Copy address" }),
    ).toHaveCount(3);
  });
});

test.describe("OpenGraph cards (Phase 2E)", () => {
  async function ogImageContent(page: import("@playwright/test").Page): Promise<string> {
    const content = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(content).toBeTruthy();
    return content as string;
  }

  test("home page's og:image/twitter:image point at the default card and resolve to a real PNG", async ({
    page,
  }) => {
    await page.goto("/");
    const content = await ogImageContent(page);
    expect(content).toBe("https://theallodium.org/og-default.png");
    const res = await page.request.get(new URL(content).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("an entry page's og:image points at /og/:id.png and resolves (falls back to the default card in this local/test R2 bucket)", async ({
    page,
  }) => {
    await page.goto("/psychotherapy/entries/aaaaaaaa00000001");
    const content = await ogImageContent(page);
    expect(content).toBe("https://theallodium.org/og/aaaaaaaa00000001.png");

    const twitterContent = await page
      .locator('meta[name="twitter:image"]')
      .getAttribute("content");
    expect(twitterContent).toBe(content);

    // No card has ever been uploaded to this dev/test environment's R2
    // bucket, so the route's own miss-fallback kicks in -- still a real,
    // reachable 200 PNG response (Playwright follows the redirect), never a
    // broken image on a live social-preview fetch.
    const res = await page.request.get(new URL(content).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("search page's og:image resolves to a real PNG", async ({ page }) => {
    await page.goto("/psychotherapy/search");
    const content = await ogImageContent(page);
    const res = await page.request.get(new URL(content).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });
});

test.describe("Open Index browse web", () => {
  test("walks a topic, keyword, venue, publisher, organization, subject, and retraction", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<sitemapindex");

    await page.goto("/fields");
    await expect(page.getByRole("heading", { name: "Field map" })).toBeVisible();
    await page.getByRole("link", { name: /Health Sciences/ }).click();
    await page.getByRole("link", { name: /Psychology/ }).click();
    await page.getByRole("link", { name: /Clinical Psychology/ }).click();
    await page.getByRole("link", { name: /Cognitive Behavioral Therapy/ }).click();
    await expect(
      page.getByRole("heading", { name: "Cognitive Behavioral Therapy" }),
    ).toBeVisible();
    await expect(page.getByText(/no authoritative topic-to-venue link/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Search papers" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto("/keywords/therapy");
    await expect(page.getByRole("link", { name: /Cognitive Behavioral Therapy/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Behavioral Economics/ })).toBeVisible();

    await page.goto("/venues/S1");
    await expect(page.getByRole("heading", { name: "Example Journal" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Example Press" })).toBeVisible();

    await page.goto("/issn/1234-5678");
    await expect(page).toHaveURL(/\/venues\/S1$/);

    await page.goto("/publishers/P1");
    await expect(page.getByRole("link", { name: /Example Press Journals/ })).toBeVisible();

    await page.goto("/organizations/01abcde12");
    await expect(page.getByRole("heading", { name: "Institute of Example" })).toBeVisible();

    await page.goto("/subjects/Medicine");
    await expect(page.getByRole("link", { name: "Example Journal" })).toBeVisible();

    await page.goto("/retractions/RW1");
    await expect(page.getByRole("heading", { name: "Notice of retraction" })).toBeVisible();
    await expect(page.getByRole("link", { name: "10.1000/example" })).toBeVisible();
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("topic page still offers a plain search link and keeps the loader hidden", async ({
      page,
    }) => {
      await page.goto("/fields/D1/FL1/SF1/T1");
      await expect(page.getByRole("link", { name: "Search papers" })).toHaveAttribute(
        "href",
        "/search?q=Cognitive%20Behavioral%20Therapy",
      );
      await expect(page.getByRole("button", { name: "Load papers here" })).toBeHidden();
    });
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
