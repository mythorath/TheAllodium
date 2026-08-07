import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import fixtureSql from "../fixtures/spike_fixture.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";
import { SITE_URL } from "../src/site-config";

// Phase 2E: fixtures/spike_fixture.sql's snapshot_manifest row has a fixed
// checksum, so the route's R2 key for a fixture entry is deterministic.
const FIXTURE_CHECKSUM = "fixture-checksum-phase1a";

// A minimal but genuinely valid 1x1 transparent PNG. These tests only ever
// assert that the route serves *this exact* R2 object with the right
// headers -- pixel content is irrelevant, so a tiny fixture keeps the test
// file small.
const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function fixturePngBytes(): Uint8Array {
  return Uint8Array.from(atob(FIXTURE_PNG_BASE64), (c) => c.charCodeAt(0));
}

async function loadFixture() {
  await execStatements(env.DB, fixtureSql);
  await execStatements(env.DB, ftsSql);
}

describe("GET /og/:filename (Phase 2E)", () => {
  beforeAll(async () => {
    await loadFixture();
    await env.OG_CARDS.put(
      `${FIXTURE_CHECKSUM}/aaaaaaaa00000001.png`,
      fixturePngBytes(),
    );
  });

  it("serves the R2 object for a canonical id with an immutable cache header", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/og/aaaaaaaa00000001.png", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(fixturePngBytes());
  });

  it("resolves an alias id to its canonical entry's card (retired000000001 -> aaaaaaaa00000001)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/og/retired000000001.png", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(fixturePngBytes());
  });

  it("redirects to the default card for an unknown id", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/og/does-not-exist.png",
      { redirect: "manual" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/og-default.png");
  });

  it("redirects to the default card when the checksum-keyed R2 object was never uploaded", async () => {
    const ctx = createExecutionContext();
    // aaaaaaaa00000002 is a real fixture entry, but no card was ever put()
    // for it -- this is the "R2 miss for a known id" case, standing in for
    // a rolled-back checksum whose cards were already pruned.
    const res = await app.request(
      "/og/aaaaaaaa00000002.png",
      { redirect: "manual" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/og-default.png");
  });

  it("redirects to the default card for a filename missing the .png suffix", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/og/aaaaaaaa00000001",
      { redirect: "manual" },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/og-default.png");
  });
});

describe("OpenGraph / Twitter meta tags (Phase 2E)", () => {
  beforeAll(loadFixture);

  it("renders og/twitter tags with the per-entry card and a contract-safe description", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/entries/aaaaaaaa00000001",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();

    expect(html).toContain('<meta property="og:type" content="article"/>');
    expect(html).toContain(
      `<meta property="og:url" content="${SITE_URL}/psychotherapy/entries/aaaaaaaa00000001"/>`,
    );
    expect(html).toContain(
      `<meta property="og:image" content="${SITE_URL}/og/aaaaaaaa00000001.png"/>`,
    );
    expect(html).toContain(
      `<meta name="twitter:image" content="${SITE_URL}/og/aaaaaaaa00000001.png"/>`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    // Synthesized only from resource_type/therapy_modality/source_org --
    // never abstract/notes/rationale.
    expect(html).toContain(
      '<meta property="og:description" content="worksheet · act · Example Clinical Org"/>',
    );
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/i);
  });

  it("falls back to the default card image on pages with no per-entry card", async () => {
    for (const path of ["/", "/psychotherapy/search", "/standard", "/disclaimer"]) {
      const ctx = createExecutionContext();
      const res = await app.request(path, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      const html = await res.text();
      expect(html).toContain(
        `<meta property="og:image" content="${SITE_URL}/og-default.png"/>`,
      );
      expect(html).toContain(
        `<meta name="twitter:image" content="${SITE_URL}/og-default.png"/>`,
      );
      expect(html).toContain('<meta property="og:description"');
    }
  });

  it("omits og/twitter tags on pages with no single canonical URL", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/this-route-does-not-exist", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
  });
});
