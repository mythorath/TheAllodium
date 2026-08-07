import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import {
  sanitizeFtsQuery,
  sanitizeLikeNeedle,
  searchEntries,
  getEntry,
  getManifest,
  resolveCanonicalId,
} from "../src/db/repository";
import fixtureSql from "../fixtures/spike_fixture.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";

async function loadFixture() {
  await execStatements(env.DB, fixtureSql);
  await execStatements(env.DB, ftsSql);
}

describe("query sanitizers", () => {
  it("builds a safe FTS prefix query", () => {
    expect(sanitizeFtsQuery("Values Clarification!")).toBe(
      '"values"* AND "clarification"*',
    );
    expect(sanitizeFtsQuery("a")).toBeNull();
  });

  it("strips LIKE wildcards from user input", () => {
    expect(sanitizeLikeNeedle("100%_defusion")).toBe("%100 defusion%");
  });
});

describe("local D1 repository + routes", () => {
  beforeAll(async () => {
    await loadFixture();
  });

  it("loads the snapshot manifest with abstract search off", async () => {
    const row = await env.DB.prepare(
      "SELECT entry_count, abstract_search_enabled FROM snapshot_manifest WHERE id = 1",
    ).first<{ entry_count: number; abstract_search_enabled: number }>();
    expect(row?.entry_count).toBe(12);
    expect(row?.abstract_search_enabled).toBe(0);
  });

  it("parses coverage_json into a typed object via getManifest", async () => {
    const manifest = await getManifest(env.DB);
    expect(manifest).not.toBeNull();
    expect(manifest?.entry_count).toBe(12);
    // Fixture predates migration 0003's default; parsing '{}' must not throw.
    expect(manifest?.coverage_json).toEqual({});
  });

  it("rebuilds FTS without indexing abstracts when gate is off", async () => {
    const ftsCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entry_fts",
    ).first<{ c: number }>();
    expect(ftsCount?.c).toBe(12);

    const abstractOnly = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM entry_fts WHERE entry_fts MATCH '"evaluates"'`,
    ).first<{ c: number }>();
    expect(abstractOnly?.c).toBe(0);

    const titleHit = await env.DB.prepare(
      `SELECT entry_id FROM entry_fts WHERE entry_fts MATCH '"values"'`,
    ).first<{ entry_id: string }>();
    expect(titleHit?.entry_id).toBe("aaaaaaaa00000001");
  });

  it("resolves canonical entries and aliases", async () => {
    const canonical = await resolveCanonicalId(env.DB, "aaaaaaaa00000001");
    expect(canonical).toEqual({
      kind: "canonical",
      canonicalId: "aaaaaaaa00000001",
    });

    const alias = await resolveCanonicalId(env.DB, "retired000000001");
    expect(alias).toEqual({
      kind: "alias",
      canonicalId: "aaaaaaaa00000001",
    });

    const missing = await resolveCanonicalId(env.DB, "doesnotexist0000");
    expect(missing.kind).toBe("missing");
  });

  it("returns a public entry without forbidden fields", async () => {
    const entry = await getEntry(env.DB, "bbbbbbbb00000003");
    expect(entry?.doi).toBe("10.1000/act.depression.meta");
    expect(entry?.tags.some((t: { name: string }) => t.name === "depression")).toBe(
      true,
    );
    expect(
      entry?.verifications.some(
        (v: { check_kind: string }) => v.check_kind === "identity",
      ),
    ).toBe(true);
    expect(JSON.stringify(entry)).not.toMatch(/abstract/i);
    expect(JSON.stringify(entry)).not.toMatch(/notes/i);
    expect(JSON.stringify(entry)).not.toMatch(/file_path/i);
  });

  it("ranks FTS results for representative queries", async () => {
    const values = await searchEntries(env.DB, "values");
    expect(values.mode).toBe("fts");
    expect(values.hits[0]?.id).toBe("aaaaaaaa00000001");

    const depression = await searchEntries(env.DB, "depression");
    expect(depression.total).toBeGreaterThanOrEqual(2);
    expect(depression.hits.every((h) => !("abstract" in h))).toBe(true);
  });

  it("falls back to LIKE over title+meta only", async () => {
    const result = await searchEntries(env.DB, "defusion", 1, {
      forceLike: true,
    });
    expect(result.mode).toBe("like");
    expect(result.hits.some((h) => h.id === "aaaaaaaa00000002")).toBe(true);

    const abstractLeak = await searchEntries(env.DB, "SYNTHETIC ABSTRACT", 1, {
      forceLike: true,
    });
    expect(abstractLeak.total).toBe(0);
  });

  it("serves entry HTML and alias redirect", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/entries/aaaaaaaa00000001",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Values Clarification Worksheet");
    expect(html).toContain("Automated checks only");
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/i);
    expect(html).not.toMatch(/file_path/i);

    const aliasCtx = createExecutionContext();
    const aliasRes = await app.request(
      "/psychotherapy/entries/retired000000001",
      { redirect: "manual" },
      env,
      aliasCtx,
    );
    await waitOnExecutionContext(aliasCtx);
    expect(aliasRes.status).toBe(301);
    expect(aliasRes.headers.get("Location")).toBe(
      "/psychotherapy/entries/aaaaaaaa00000001",
    );
  });

  it("serves search HTML and labels blocked links", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?q=trauma",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Trauma-Focused CBT Overview");
    expect(html).toContain("link inconclusive");
  });

  it("shows an explicit empty state for a query with zero hits", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?q=zzzznoresultsxyz",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No results for");
  });

  it("serves the home page with live manifest stats", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("12 entries");
    expect(html).toContain("/standard");
  });

  it("serves /standard with coverage numbers and no forbidden fields", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/standard", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("The Standard");
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/i);
    expect(html).not.toMatch(/file_path/i);
  });

  it("serves /disclaimer with crisis routing", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/disclaimer", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("988");
    expect(html).toContain("findahelpline.com");
  });

  it("never sets a Set-Cookie header on any route (no accounts, no tracking)", async () => {
    const routes = [
      "/",
      "/standard",
      "/disclaimer",
      "/psychotherapy/search?q=trauma",
      "/psychotherapy/entries/aaaaaaaa00000001",
      "/does-not-exist",
    ];
    for (const path of routes) {
      const ctx = createExecutionContext();
      const res = await app.request(path, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("escapes HTML in titles", async () => {
    await env.DB.prepare(`UPDATE entries SET title = ? WHERE id = ?`)
      .bind(`<script>alert("xss")</script> Safe Title`, "ffffffff00000011")
      .run();
    await env.DB.prepare(
      `UPDATE entry_search_documents SET title = ? WHERE entry_id = ?`,
    )
      .bind(`<script>alert("xss")</script> Safe Title`, "ffffffff00000011")
      .run();

    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/entries/ffffffff00000011",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("can enable abstract indexing via manifest gate without leaking to HTML", async () => {
    await env.DB.prepare(
      `UPDATE snapshot_manifest SET abstract_search_enabled = 1 WHERE id = 1`,
    ).run();
    await execStatements(env.DB, ftsSql);

    const abstractHit = await env.DB.prepare(
      `SELECT entry_id FROM entry_fts WHERE entry_fts MATCH '"evaluates"'`,
    ).first<{ entry_id: string }>();
    expect(abstractHit?.entry_id).toBe("bbbbbbbb00000003");

    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?q=evaluates",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain("Acceptance and Commitment Therapy for Depression");
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/i);

    await env.DB.prepare(
      `UPDATE snapshot_manifest SET abstract_search_enabled = 0 WHERE id = 1`,
    ).run();
    await execStatements(env.DB, ftsSql);
  });
});
