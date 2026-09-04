import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
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
    expect(topic.body).toContain("no authoritative topic-to-venue link");
    expect(topic.body).toContain('href="/search?q=Cognitive%20Behavioral%20Therapy"');
    expect(topic.body).toContain('data-load-works="/partials/works?q=Cognitive%20Behavioral%20Therapy"');
    expect(topic.body).toContain('href="/keywords/therapy"');
    expect(topic.body).toContain('src="/app.js"');
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

  it("rejects an underspecified works partial without calling federation", async () => {
    const page = await html("/partials/works?q=x");
    expect(page.response.status).toBe(400);
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
