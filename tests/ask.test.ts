import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import fixtureSql from "../fixtures/spike_fixture.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";

const GPU_ENV = {
  ...env,
  GPU_ORIGIN: "https://gpu.theallodium.org",
  GPU_SHARED_SECRET: "test-secret",
};

async function loadFixture() {
  await execStatements(env.DB, fixtureSql);
  await execStatements(env.DB, ftsSql);
}

describe("?ask= NL search (Phase 3B)", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    await loadFixture();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("redirects crisis intent to ?q=&crisis=1 without calling fetch", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?ask=" + encodeURIComponent("I want to kill myself"),
      { redirect: "manual" },
      GPU_ENV,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("crisis=1");
    expect(res.headers.get("Location")).toContain("q=");
    expect(res.headers.get("Location")).not.toContain("ask=");
    expect(called).toBe(false);
  });

  it("does not treat trauma worksheets as crisis", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?ask=" + encodeURIComponent("trauma worksheets"),
      { redirect: "manual" },
      GPU_ENV,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).not.toContain("crisis=1");
    expect(called).toBe(true);
  });

  it("redirects mixed-case GPU JSON onto canonical facet params", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          kind: "materials",
          modality: ["ACT"],
          topic: ["Depression"],
          q: "worksheets",
        }),
        { status: 200 },
      )) as typeof fetch;
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?ask=" + encodeURIComponent("ACT worksheets for depression"),
      { redirect: "manual" },
      GPU_ENV,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("kind=materials");
    expect(location).toContain("modality=act");
    expect(location).toContain("topic=depression");
    expect(location).toContain("q=worksheets");
    expect(location).not.toContain("ask=");
  });

  it("drops hallucinated facet values", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          modality: ["research papers", "act"],
          topic: ["not-a-real-tag"],
        }),
        { status: 200 },
      )) as typeof fetch;
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?ask=act",
      { redirect: "manual" },
      GPU_ENV,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("modality=act");
    expect(location).not.toContain("research");
    expect(location).not.toContain("not-a-real-tag");
  });

  it("falls back to assist=offline on timeout, 500, 401, and malformed JSON", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => {
        throw new DOMException("Aborted", "AbortError");
      },
      async () => new Response("no", { status: 500 }),
      async () => new Response("no", { status: 401 }),
      async () => new Response("not-json", { status: 200 }),
    ];
    for (const impl of cases) {
      globalThis.fetch = impl as typeof fetch;
      const ctx = createExecutionContext();
      const res = await app.request(
        "/psychotherapy/search?ask=cbt+worksheets",
        { redirect: "manual" },
        GPU_ENV,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("assist=offline");
      expect(res.headers.get("Location")).toContain("q=cbt");
    }
  });

  it("falls back when secret is unset without calling fetch", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?ask=cbt+worksheets",
      { redirect: "manual" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("assist=offline");
    expect(called).toBe(false);
  });

  it("does not call the GPU when ask is empty", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const ctx = createExecutionContext();
    const res = await app.request("/psychotherapy/search?q=trauma", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="search-ask"');
    expect(html).toContain('name="ask"');
    expect(html).not.toContain("AI search assist is offline");
    expect(called).toBe(false);
  });

  it("renders crisis copy and the offline notice from display flags", async () => {
    const crisisCtx = createExecutionContext();
    const crisisRes = await app.request(
      "/psychotherapy/search?q=trauma&crisis=1",
      {},
      env,
      crisisCtx,
    );
    await waitOnExecutionContext(crisisCtx);
    const crisisHtml = await crisisRes.text();
    expect(crisisHtml).toContain("If you need help now");
    expect(crisisHtml).toContain("988");
    expect(crisisHtml).not.toContain('name="crisis"');

    const assistCtx = createExecutionContext();
    const assistRes = await app.request(
      "/psychotherapy/search?q=trauma&assist=offline",
      {},
      env,
      assistCtx,
    );
    await waitOnExecutionContext(assistCtx);
    const assistHtml = await assistRes.text();
    expect(assistHtml).toContain("AI search assist is offline");
    expect(assistHtml).not.toContain('name="assist"');
  });
});
