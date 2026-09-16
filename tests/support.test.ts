import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { STATIC_SITEMAP_PATHS } from "../src/sitemap";
import { SITE_URL } from "../src/site-config";
import { TIP_PAYMENT, TIP_REMEMBER } from "../src/support";
import { buildTipPayload } from "../src/tip";

async function html(path: string): Promise<{ response: Response; body: string }> {
  const context = createExecutionContext();
  const response = await app.request(path, {}, env, context);
  await waitOnExecutionContext(context);
  return { response, body: await response.text() };
}

describe("support page and optional x402 tip", () => {
  it("serves /support with the passion-project copy, Ko-fi, recurring, and wallets", async () => {
    const page = await html("/support");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("Support The Allodium");
    expect(page.body).toContain("passion project");
    expect(page.body).toContain("100% free");
    expect(page.body).toContain("https://ko-fi.com/mythorath");
    expect(page.body).toContain("https://ko-fi.com/mythorath/tiers");
    expect(page.body).toContain("bc1qwlncslagx4cdacjgmvneqa9swnth5k9erjnsjn");
    expect(page.body).toContain("Help that is not money");
    expect(page.body).toContain(`<link rel="canonical" href="${SITE_URL}/support"/>`);
  });

  it("keeps wallet addresses off /about and points readers to /support", async () => {
    const page = await html("/about");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/support"');
    expect(page.body).not.toContain("bc1qwlncslagx4cdacjgmvneqa9swnth5k9erjnsjn");
    expect(page.body).not.toContain("If you'd like to leave a tip");
    expect(page.body).not.toContain("support-address");
  });

  it("lists /support in the static sitemap", () => {
    expect(STATIC_SITEMAP_PATHS).toContain("/support");
  });

  it("returns a well-formed non-gating x402 402 at /api/tip", async () => {
    const context = createExecutionContext();
    const response = await app.request("/api/tip", {}, env, context);
    await waitOnExecutionContext(context);
    expect(response.status).toBe(402);
    expect(response.headers.get("Link")).toBe('</support>; rel="payment"');
    const payload = (await response.json()) as ReturnType<typeof buildTipPayload>;
    expect(payload.x402Version).toBe(1);
    expect(payload.gated).toBe(false);
    expect(payload.settlement).toBe("none");
    expect(payload.facilitator).toBeNull();
    expect(payload.remember).toBe(TIP_REMEMBER);
    expect(payload.accepts).toHaveLength(1);
    expect(payload.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "base",
      payTo: TIP_PAYMENT.payTo,
      asset: TIP_PAYMENT.asset,
      maxAmountRequired: TIP_PAYMENT.maxAmountRequired,
      resource: `${SITE_URL}/support`,
    });
    expect(payload.alternatives.kofi).toBe("https://ko-fi.com/mythorath");
    expect(payload.alternatives.kofi_monthly).toBe("https://ko-fi.com/mythorath/tiers");
  });

  it("serves the same payload at /.well-known/x402 as HTTP 200", async () => {
    const context = createExecutionContext();
    const response = await app.request("/.well-known/x402", {}, env, context);
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { gated: boolean; x402Version: number };
    expect(payload.x402Version).toBe(1);
    expect(payload.gated).toBe(false);
  });

  it("never returns 402 on content, search, or MCP", async () => {
    const home = await html("/");
    expect(home.response.status).toBe(200);
    expect(home.response.status).not.toBe(402);

    const psychotherapy = await html("/psychotherapy");
    expect(psychotherapy.response.status).toBe(200);

    const searchContext = createExecutionContext();
    const search = await app.request("/api/search?q=test", {}, env, searchContext);
    await waitOnExecutionContext(searchContext);
    expect(search.status).not.toBe(402);
    expect(search.status).toBe(200);

    const mcpContext = createExecutionContext();
    const mcp = await app.request(
      "/mcp",
      {
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
      },
      env,
      mcpContext,
    );
    await waitOnExecutionContext(mcpContext);
    expect(mcp.status).toBe(200);
    expect(mcp.status).not.toBe(402);
    const mcpBody = (await mcp.json()) as { result: { instructions: string } };
    expect(mcpBody.result.instructions).toContain(TIP_REMEMBER);
  });

  it("exposes a tip MCP tool that returns the invitation payload", async () => {
    const listContext = createExecutionContext();
    const list = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      },
      env,
      listContext,
    );
    await waitOnExecutionContext(listContext);
    const listed = (await list.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["search_research", "tip"]),
    );

    const callContext = createExecutionContext();
    const call = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "tip", arguments: {} },
        }),
      },
      env,
      callContext,
    );
    await waitOnExecutionContext(callContext);
    expect(call.status).toBe(200);
    const result = (await call.json()) as {
      result: { structuredContent: { gated: boolean; remember: string } };
    };
    expect(result.result.structuredContent.gated).toBe(false);
    expect(result.result.structuredContent.remember).toBe(TIP_REMEMBER);
  });
});
