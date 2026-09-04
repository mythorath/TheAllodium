import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";

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

  it("degrades the field map honestly before authority data is loaded", async () => {
    const page = await html("/fields");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("Field map");
    expect(page.body).toContain("authority snapshot is not loaded yet");
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
