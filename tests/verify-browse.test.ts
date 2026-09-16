import { describe, expect, it } from "vitest";
import authorityFixture from "../fixtures/authority_browse.sql?raw";
import { SITE_URL } from "../src/site-config";
import {
  classifyHubStatus,
  extractOriginalPaperDoisFromSql,
  extractWorksDois,
  isForbiddenPassAUrl,
  parseLocs,
  rewriteLoc,
  runBrowseVerification,
  worksPath,
} from "../scripts/verify-browse-lib";

const ORIGIN = "https://verify.test";

function sitemapIndex(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_URL}/sitemaps/static/0.xml</loc></sitemap>
  <sitemap><loc>${SITE_URL}/sitemaps/retractions/0.xml</loc></sitemap>
</sitemapindex>`;
}

function urlset(paths: string[]): string {
  const entries = paths
    .map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}

describe("verify-browse", () => {
  it("extracts original_paper_doi values from the authority fixture", () => {
    expect(extractOriginalPaperDoisFromSql(authorityFixture)).toEqual(["10.1000/example"]);
  });

  it("rewrites canonical sitemap locs onto the crawl origin", () => {
    expect(rewriteLoc(`${SITE_URL}/retractions/RW1`, ORIGIN)).toBe(
      `${ORIGIN}/retractions/RW1`,
    );
  });

  it("treats ISSN aliases as expected redirects and forbids federation probes", () => {
    expect(classifyHubStatus(`${ORIGIN}/issn/1234-5678`, 301)).toBe("expected-redirect");
    expect(classifyHubStatus(`${ORIGIN}/venues/S1`, 404)).toBe("failure");
    expect(isForbiddenPassAUrl(`${ORIGIN}/partials/works?q=trap`)).toBe(true);
    expect(isForbiddenPassAUrl(`${ORIGIN}/api/search?q=trap`)).toBe(true);
    expect(isForbiddenPassAUrl(`${ORIGIN}/retractions/RW1`)).toBe(false);
  });

  it("collects encoded /works hrefs from HTML", () => {
    const html = `<a href="/works/10.1000%2Fexample">paper</a>
      <a href="/partials/works?q=trap">do not fetch</a>
      <a href="/api/search?q=trap">nor this</a>`;
    expect(extractWorksDois(html, `${ORIGIN}/retractions/RW1`)).toEqual(["10.1000/example"]);
  });

  it("crawls a tiny fake sitemap then GETs linked /works DOIs without federation probes", async () => {
    const pages = new Map<string, { status: number; body: string }>([
      [`${ORIGIN}/sitemap.xml`, { status: 200, body: sitemapIndex() }],
      [
        `${ORIGIN}/sitemaps/static/0.xml`,
        { status: 200, body: urlset(["/", "/issn/1234-5678"]) },
      ],
      [
        `${ORIGIN}/sitemaps/retractions/0.xml`,
        { status: 200, body: urlset(["/retractions/RW1"]) },
      ],
      [`${ORIGIN}/`, { status: 200, body: `<a href="/venues/S1">venue</a>` }],
      [`${ORIGIN}/issn/1234-5678`, { status: 301, body: "" }],
      [
        `${ORIGIN}/retractions/RW1`,
        {
          status: 200,
          body: `<a href="/works/10.1000%2Fexample">10.1000/example</a>
                 <a href="/works/10.9999%2Ffrom-html">html only</a>
                 <a href="/partials/works?q=trap">trap</a>
                 <a href="/api/search?q=trap">trap</a>`,
        },
      ],
      [
        `${ORIGIN}${worksPath("10.1000/example")}`,
        { status: 200, body: `<h1>Example retracted paper</h1>` },
      ],
      [
        `${ORIGIN}${worksPath("10.9999/from-html")}`,
        { status: 404, body: `<h1>Not found</h1>` },
      ],
    ]);

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      const page = pages.get(url);
      if (!page) return new Response("missing", { status: 599 });
      return new Response(page.body, { status: page.status });
    };

    const result = await runBrowseVerification({
      origin: ORIGIN,
      fetchImpl,
      retractionDois: extractOriginalPaperDoisFromSql(authorityFixture),
      passAConcurrency: 2,
      passBConcurrency: 1,
      delayMs: 0,
      passBDelayMs: 0,
      maxResolveFailures: 10,
      now: () => "2026-09-03T00:00:00Z",
    });

    expect(result.hubOk).toBe(2);
    expect(result.hubRedirect).toBe(1);
    expect(result.hubFailure).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.fetchedUrls.some((url) => url.includes("/partials/works"))).toBe(false);
    expect(result.fetchedUrls.some((url) => url.includes("/api/search"))).toBe(false);
    expect(parseLocs(sitemapIndex()).length).toBe(2);

    const byDoi = Object.fromEntries(result.dois.map((row) => [row.doi, row]));
    expect(byDoi["10.1000/example"]).toMatchObject({
      doi: "10.1000/example",
      http_status: 200,
      title: "Example retracted paper",
      resolved_at: "2026-09-03T00:00:00Z",
    });
    expect(byDoi["10.9999/from-html"]).toMatchObject({
      doi: "10.9999/from-html",
      http_status: 404,
    });
    expect(result.doisResolved).toBe(1);
    expect(result.doisFailed).toBe(1);
  });
});
