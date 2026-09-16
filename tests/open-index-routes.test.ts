import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { STATIC_SITEMAP_PATHS } from "../src/sitemap";
import { SITE_URL } from "../src/site-config";
import { clearAuthority, resetAuthority } from "./authority-fixture";

async function html(path: string): Promise<{ response: Response; body: string }> {
  const context = createExecutionContext();
  const response = await app.request(path, {}, env, context);
  await waitOnExecutionContext(context);
  return { response, body: await response.text() };
}

describe("Open Index routes", () => {
  it("serves the all-fields doorway and empty search without upstream calls", async () => {
    const landing = await html("/open-index");
    expect(landing.response.status).toBe(200);
    expect(landing.body).toContain("Research across every field");
    expect(landing.body).toContain('action="/search"');
    expect(landing.body).toContain('href="/keywords"');
    expect(landing.body).toContain('href="/venues"');

    const search = await html("/search");
    expect(search.response.status).toBe(200);
    expect(search.body).toContain("Search every field");
    expect(search.body).toContain("independent upstream indexes");
  });

  it("publishes source coverage and named blind spots", async () => {
    const page = await html("/coverage");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("Coverage, including the gaps");
    expect(page.body).toContain("Crossref");
    expect(page.body).toContain("CNKI and Wanfang");
    expect(page.body).toContain("DBLP direct API");
    expect(page.body).toContain("Anubis");
    expect(page.body).toContain("60–70%");
  });

  it("degrades the field map honestly when the snapshot has no taxonomy rows", async () => {
    expect(env.AUTHORITY).toBeDefined();
    await clearAuthority(env.AUTHORITY!);
    try {
      const page = await html("/fields");
      expect(page.response.status).toBe(200);
      expect(page.body).toContain("Field map");
      expect(page.body).toContain("authority snapshot is not loaded yet");
    } finally {
      await resetAuthority(env.AUTHORITY!);
    }
  });

  it("renders scoped taxonomy pages including the topic leaf", async () => {
    const fields = await html("/fields");
    expect(fields.response.status).toBe(200);
    expect(fields.body).toContain("Health Sciences");
    expect(fields.body).toContain("/fields/D1");

    const topic = await html("/fields/D1/FL1/SF1/T1");
    expect(topic.response.status).toBe(200);
    expect(topic.body).toContain("Cognitive Behavioral Therapy");
    expect(topic.body).toContain("OpenAlex snapshot");
    expect(topic.body).toContain("not an endorsement");
    expect(topic.body).toContain("no authoritative topic-to-venue");
    expect(topic.body).toContain("Most cited");
    expect(topic.body).toContain("Most recent");
    expect(topic.body).toContain("Retracted example paper");
    expect(topic.body).toContain("Retracted");
    expect(topic.body).toContain('href="/works/10.1000%2Fexample"');
    expect(topic.body).toContain('href="/search?q=Cognitive%20Behavioral%20Therapy"');
    expect(topic.body).not.toContain("data-load-works=");
    expect(topic.body).toContain('href="/keywords/therapy"');
    expect(topic.body).toContain('src="/app.js"');
    expect(topic.body).toContain('href="/retractions/reasons"');
    expect(topic.response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("bridges topics through a shared keyword", async () => {
    const page = await html("/keywords/therapy");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("Cognitive Behavioral Therapy");
    expect(page.body).toContain("Behavioral Economics");
    expect(page.body).toContain("Health Sciences");
    expect(page.body).toContain("Social Sciences");
  });

  it("renders venue, ISSN alias, publisher, organization, subject, and retraction pages", async () => {
    const venue = await html("/venues/S1");
    expect(venue.response.status).toBe(200);
    expect(venue.body).toContain("Example Journal");
    expect(venue.body).toContain("Example Press");
    expect(venue.body).toContain("NLM N1");
    expect(venue.body).toContain("Medicine");
    expect(venue.body).toContain("Notice of retraction");

    const issn = await html("/issn/1234-5678");
    expect(issn.response.status).toBe(301);
    expect(issn.response.headers.get("location")).toBe("/venues/S1");

    const publisher = await html("/publishers/P1");
    expect(publisher.response.status).toBe(200);
    expect(publisher.body).toContain("Example Press Journals");
    expect(publisher.body).toContain("Example Journal");

    const org = await html("/organizations/01abcde12");
    expect(org.response.status).toBe(200);
    expect(org.body).toContain("Institute of Example");
    expect(org.body).toContain("01abcde12");

    const subject = await html("/subjects/Medicine");
    expect(subject.response.status).toBe(200);
    expect(subject.body).toContain("Example Journal");

    const notice = await html("/retractions/RW1");
    expect(notice.response.status).toBe(200);
    expect(notice.body).toContain("Notice of retraction");
    expect(notice.body).toContain("/works/10.1000%2Fexample");
    expect(notice.body).toContain("/retractions/reasons/Error");
  });

  it("renders precomputed papers and a Retracted badge on taxonomy hubs", async () => {
    const domain = await html("/fields/D1");
    expect(domain.response.status).toBe(200);
    expect(domain.response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(domain.body).toContain('href="/fields"');
    expect(domain.body).toContain("Most cited");
    expect(domain.body).toContain("Most cited clinical paper");
    expect(domain.body).toContain("Retracted example paper");
    expect(domain.body).toContain("Retracted");
    expect(domain.body).toContain("Other domains");
    expect(domain.body).toContain("Social Sciences");
    expect(domain.body).toContain('href="/keywords"');
    expect(domain.body).toContain('href="/venues"');
    expect(domain.body).toContain('href="/publishers"');
    expect(domain.body).toContain('href="/organizations"');
    expect(domain.body).toContain('href="/subjects"');
    expect(domain.body).toContain('href="/retractions"');
    expect(domain.body).toContain('href="/retractions/reasons"');

    const field = await html("/fields/D1/FL1");
    expect(field.response.status).toBe(200);
    expect(field.body).toContain('href="/fields"');
    expect(field.body).toContain("Health Sciences");
    expect(field.body).toContain("Most cited");
    expect(field.body).toContain("Most cited clinical paper");
    expect(field.body).toContain("Recent clinical paper");
    expect(field.body).not.toContain("Retracted example paper");

    const subfield = await html("/fields/D1/FL1/SF1");
    expect(subfield.response.status).toBe(200);
    expect(subfield.body).toContain("Clinical Psychology");
    expect(subfield.body).toContain("Most cited");
    expect(subfield.body).toContain("Most recent");
    expect(subfield.body).toContain("Retracted example paper");
    expect(subfield.body).toContain(">Retracted<");
    expect(subfield.body).toContain('href="/works/10.1000%2Fexample"');
    expect(subfield.body).toContain('href="/works/10.1000%2Fcited-ok"');
    expect(subfield.body).toContain('href="/works/10.1000%2Frecent-ok"');
    expect(subfield.body).toContain("Search this subfield");
    expect(subfield.body).toContain('href="/keywords/therapy"');
    expect(subfield.body).toContain('href="/keywords/cognition"');
    expect(subfield.body).not.toContain("Other subfields in this field");
  });

  it("omits the papers section when a taxonomy hub has no precomputed rows", async () => {
    const domain = await html("/fields/D2");
    expect(domain.response.status).toBe(200);
    expect(domain.body).toContain("Social Sciences");
    expect(domain.body).toContain("Search this domain");
    expect(domain.body).not.toContain("Most cited");
    expect(domain.body).not.toContain("Most recent");
    expect(domain.body).not.toContain("class=\"result-list\"");

    const topic = await html("/fields/D2/FL2/SF2/T2");
    expect(topic.response.status).toBe(200);
    expect(topic.body).toContain("Behavioral Economics");
    expect(topic.body).toContain("Search papers");
    expect(topic.body).not.toContain("Most cited");
    expect(topic.body).not.toContain("Retracted example paper");
    expect(topic.body).not.toContain("data-load-works=");
  });

  it("renders sibling and co-occurrence rails on long-tail hubs", async () => {
    const keyword = await html("/keywords/therapy");
    expect(keyword.response.status).toBe(200);
    expect(keyword.body).toContain("Co-occurring keywords");
    expect(keyword.body).toContain('href="/keywords/cognition"');
    expect(keyword.body).toContain('href="/keywords/decision"');
    expect(keyword.body).toContain('data-load-works="/partials/works?q=therapy"');

    const subject = await html("/subjects/Medicine");
    expect(subject.response.status).toBe(200);
    expect(subject.body).toContain("Co-occurring DOAJ subjects");
    expect(subject.body).toContain('href="/subjects/Psychology"');

    const reason = await html("/retractions/reasons/Error");
    expect(reason.response.status).toBe(200);
    expect(reason.body).toContain("Journals with this reason");
    expect(reason.body).toContain('href="/venues/S1"');
    expect(reason.body).toContain('href="/fields"');

    const fields = await html("/fields");
    expect(fields.body).toContain('aria-label="Browse directories"');
    expect(fields.body).toContain('href="/keywords"');
    expect(fields.body).toContain('href="/retractions/reasons"');
  });

  it("rejects an underspecified works partial without calling federation", async () => {
    const page = await html("/partials/works?q=x");
    expect(page.response.status).toBe(400);
  });

  describe("federated work pages", () => {
    const originalFetch = globalThis.fetch;
    const knownDoi = "10.1007/s00422-026-01037-5";
    const knownTitle = "Encoded DOI work page";

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function isCrossrefDirectLookup(url: URL): boolean {
      return url.hostname === "api.crossref.org" && url.pathname.startsWith("/works/");
    }

    function isCrossrefSearch(url: URL): boolean {
      return (
        url.hostname === "api.crossref.org" &&
        (url.pathname === "/works" || url.pathname === "/works/")
      );
    }

    function crossrefWorkResponse(doi: string, title: string): Response {
      return new Response(
        JSON.stringify({
          message: {
            DOI: doi,
            title: [title],
            author: [{ given: "Ada", family: "Lovelace" }],
            published: { "date-parts": [[2026, 1, 1]] },
            abstract: "Must not be redistributed",
            URL: `https://doi.org/${doi}`,
            type: "journal-article",
            "container-title": ["Biological Cybernetics"],
            publisher: "Springer",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    function mockFederationFetch(
      handler: (url: URL) => Response | undefined,
    ): { urls: string[] } {
      const urls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const href = String(input instanceof Request ? input.url : input);
        urls.push(href);
        const url = new URL(href);
        return handler(url) ?? new Response("{}", { status: 200 });
      }) as typeof fetch;
      return { urls };
    }

    it("captures encoded and slash DOI forms and serves a direct Crossref hit", async () => {
      const { urls } = mockFederationFetch((url) => {
        if (isCrossrefDirectLookup(url)) {
          return crossrefWorkResponse(knownDoi, knownTitle);
        }
        return undefined;
      });

      const encoded = await html(`/works/${encodeURIComponent(knownDoi)}`);
      expect(encoded.response.status).toBe(200);
      expect(encoded.body).toContain(knownTitle);
      expect(encoded.body).toContain(knownDoi);
      expect(encoded.body).not.toContain("Must not be redistributed");
      expect(encoded.body).not.toContain("That page does not exist.");

      const slash = await html(`/works/${knownDoi}`);
      expect(slash.response.status).toBe(200);
      expect(slash.body).toContain(knownTitle);

      expect(urls.some((href) => href.includes("query.bibliographic"))).toBe(false);
      expect(
        urls.some((href) =>
          href.startsWith("https://api.crossref.org/works/10.1007%2Fs00422-026-01037-5"),
        ),
      ).toBe(true);
    });

    it("shows the requested id when Crossref and search both miss", async () => {
      const missing = "10.9999/does-not-exist-allodium-test";
      mockFederationFetch((url) => {
        if (isCrossrefDirectLookup(url) || isCrossrefSearch(url)) {
          return new Response("Resource not found.", { status: 404 });
        }
        return undefined;
      });

      const page = await html(`/works/${encodeURIComponent(missing)}`);
      expect(page.response.status).toBe(404);
      expect(page.body).toContain("No public entry for id");
      expect(page.body).toContain(missing);
      expect(page.body).not.toContain("That page does not exist.");
    });

    it("falls back to bibliographic search when the Crossref identifier GET misses", async () => {
      const fallbackDoi = "10.1000/allodium-search-fallback";
      const fallbackTitle = "Found only via search fallback";
      mockFederationFetch((url) => {
        if (isCrossrefDirectLookup(url)) {
          return new Response("Resource not found.", { status: 404 });
        }
        if (isCrossrefSearch(url)) {
          return new Response(
            JSON.stringify({
              message: {
                items: [
                  {
                    DOI: fallbackDoi,
                    title: [fallbackTitle],
                    URL: `https://doi.org/${fallbackDoi}`,
                    type: "journal-article",
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return undefined;
      });

      const page = await html(`/works/${encodeURIComponent(fallbackDoi)}`);
      expect(page.response.status).toBe(200);
      expect(page.body).toContain(fallbackTitle);
      expect(page.body).toContain(fallbackDoi);
    });

    it("renders a cached overview and omits the section when none exists", async () => {
      mockFederationFetch((url) => {
        if (isCrossrefDirectLookup(url)) {
          return crossrefWorkResponse(knownDoi, knownTitle);
        }
        return undefined;
      });

      const without = await html(`/works/${encodeURIComponent(knownDoi)}`);
      expect(without.response.status).toBe(200);
      expect(without.body).toContain(knownTitle);
      expect(without.body).not.toContain("AI-generated summary");
      expect(without.body).not.toMatch(/<h2 id="entry-overview-heading">Overview<\/h2>/);

      await env.AUTHORITY!.prepare(
        `INSERT INTO federated_work_overviews (doi, overview, model, generated_at, source_note)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(
          knownDoi,
          "This paper studies encoded DOI routing without redistributing abstracts.",
          "qwen3.6:35b",
          "2026-09-03T00:00:00Z",
          "test",
        )
        .run();

      try {
        const withOverview = await html(`/works/${encodeURIComponent(knownDoi)}`);
        expect(withOverview.response.status).toBe(200);
        expect(withOverview.body).toContain("Overview");
        expect(withOverview.body).toContain(
          "AI-generated summary, not a substitute for reading the source.",
        );
        expect(withOverview.body).toContain(
          "This paper studies encoded DOI routing without redistributing abstracts.",
        );
        expect(withOverview.body).not.toContain("Must not be redistributed");
      } finally {
        await env.AUTHORITY!.prepare(
          "DELETE FROM federated_work_overviews WHERE doi = ?",
        )
          .bind(knownDoi)
          .run();
      }
    });
  });

  it("serves a sitemap index and paginated children", async () => {
    const index = await html("/sitemap.xml");
    expect(index.response.status).toBe(200);
    expect(index.response.headers.get("Content-Type")).toContain("application/xml");
    expect(index.body).toContain("<sitemapindex");
    expect(index.body).toContain(`${SITE_URL}/sitemaps/static/0.xml`);
    expect(index.body).toContain(`${SITE_URL}/sitemaps/keywords/0.xml`);
    expect(index.body).toContain(`${SITE_URL}/sitemaps/venues/0.xml`);

    const keywords = await html("/sitemaps/keywords/0.xml");
    expect(keywords.response.status).toBe(200);
    expect(keywords.body).toContain(`${SITE_URL}/keywords/therapy`);
    expect(keywords.body).not.toContain(`${SITE_URL}/keywords/cognition`);

    const staticMap = await html("/sitemaps/static/0.xml");
    expect((staticMap.body.match(/<url>/g) ?? []).length).toBe(STATIC_SITEMAP_PATHS.length);
  });

  it("implements stateless MCP initialize and tools/list", async () => {
    const initialize = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    }, env);
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "the-allodium-open-index" },
      },
    });

    const tools = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }, env);
    const payload = await tools.json() as {
      result: { tools: Array<{ name: string }> };
    };
    expect(payload.result.tools.map((tool) => tool.name)).toContain("search_research");
  });
});
