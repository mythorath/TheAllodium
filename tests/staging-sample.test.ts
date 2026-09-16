import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import { searchEntries } from "../src/db/repository";
import { EMPTY_FACET_FILTERS } from "../src/db/facets";
import stagingSampleSql from "../fixtures/staging_sample.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";

/**
 * Phase 1C: exercises the same route/search code paths as
 * tests/repository.test.ts, but against a real, ACT-sourced representative
 * sample (fixtures/staging_sample.sql) instead of the hand-authored
 * synthetic fixture. Assertions discover their subjects by querying the
 * loaded data rather than hardcoding real IDs/titles, so this suite stays
 * valid whenever the sample is regenerated from ACT.
 */

async function loadStagingSample() {
  await execStatements(env.DB, stagingSampleSql);
  await execStatements(env.DB, ftsSql);
}

describe("staging sample (real ACT data) - repository + routes", () => {
  beforeAll(async () => {
    await loadStagingSample();
  });

  it("loads a manifest describing a bounded sample, not the full corpus", async () => {
    const row = await env.DB.prepare(
      "SELECT entry_count, abstract_search_enabled FROM snapshot_manifest WHERE id = 1",
    ).first<{ entry_count: number; abstract_search_enabled: number }>();
    expect(row?.entry_count).toBeGreaterThan(50);
    expect(row?.entry_count).toBeLessThan(1000);
    expect(row?.abstract_search_enabled).toBe(0);
  });

  it("keeps entry_fts row count in parity with entries after rebuild", async () => {
    const entryCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries",
    ).first<{ c: number }>();
    const ftsCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entry_fts",
    ).first<{ c: number }>();
    expect(ftsCount?.c).toBe(entryCount?.c);
  });

  it("never populates abstract_text while the manifest gate is off", async () => {
    const leaked = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entry_search_documents WHERE abstract_text IS NOT NULL",
    ).first<{ c: number }>();
    expect(leaked?.c).toBe(0);
  });

  it("resolves a real alias redirect and serves the canonical entry without forbidden fields", async () => {
    const alias = await env.DB.prepare(
      "SELECT alias_id, canonical_id FROM entry_aliases LIMIT 1",
    ).first<{ alias_id: string; canonical_id: string }>();
    expect(alias).toBeTruthy();

    const aliasCtx = createExecutionContext();
    const aliasRes = await app.request(
      `/psychotherapy/entries/${alias!.alias_id}`,
      { redirect: "manual" },
      env,
      aliasCtx,
    );
    await waitOnExecutionContext(aliasCtx);
    expect(aliasRes.status).toBe(301);
    expect(aliasRes.headers.get("Location")).toBe(
      `/psychotherapy/entries/${alias!.canonical_id}`,
    );

    const canonicalCtx = createExecutionContext();
    const canonicalRes = await app.request(
      `/psychotherapy/entries/${alias!.canonical_id}`,
      {},
      env,
      canonicalCtx,
    );
    await waitOnExecutionContext(canonicalCtx);
    expect(canonicalRes.status).toBe(200);
    const html = await canonicalRes.text();
    expect(html).toContain("Automated checks only");
    expect(html).not.toMatch(/file_path/i);
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/i);
    expect(html).not.toContain("<script>");
  });

  it("labels a real blocked-link entry as inconclusive and keeps it searchable", async () => {
    const blocked = await env.DB.prepare(
      "SELECT id, title FROM entries WHERE link_status = 'blocked' LIMIT 1",
    ).first<{ id: string; title: string }>();
    expect(blocked).toBeTruthy();

    const ctx = createExecutionContext();
    const res = await app.request(
      `/psychotherapy/entries/${blocked!.id}`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("link inconclusive");

    // A blocked link stays discoverable through search (never excluded).
    const firstWord = blocked!.title.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, "");
    if (firstWord && firstWord.length >= 2) {
      const result = await searchEntries(env.DB, firstWord);
      expect(result.hits.some((h) => h.id === blocked!.id)).toBe(true);
    }
  });

  it("renders a real entry with missing bibliographic fields without crashing", async () => {
    const missing = await env.DB.prepare(
      "SELECT id FROM entries WHERE author IS NULL OR published_date IS NULL LIMIT 1",
    ).first<{ id: string }>();
    expect(missing).toBeTruthy();

    const ctx = createExecutionContext();
    const res = await app.request(
      `/psychotherapy/entries/${missing!.id}`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Not recorded");
  });

  it("ranks real FTS keyword results and paginates correctly", async () => {
    const modalityRow = await env.DB.prepare(
      `SELECT therapy_modality, COUNT(*) AS c FROM entries
       GROUP BY therapy_modality ORDER BY c DESC LIMIT 1`,
    ).first<{ therapy_modality: string; c: number }>();
    expect(modalityRow).toBeTruthy();

    const result = await searchEntries(env.DB, modalityRow!.therapy_modality);
    expect(result.mode).toBe("fts");
    expect(result.total).toBeGreaterThan(0);
    expect(result.hits.length).toBeLessThanOrEqual(result.pageSize);
    expect(result.hits.every((h) => !("abstract" in h))).toBe(true);

    const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (totalPages > 1) {
      const page2 = await searchEntries(env.DB, modalityRow!.therapy_modality, 2);
      expect(page2.hits.length).toBeGreaterThan(0);
      expect(page2.hits[0]?.id).not.toBe(result.hits[0]?.id);
    }
  });

  it("falls back to LIKE over title+meta only for the same real query", async () => {
    const modalityRow = await env.DB.prepare(
      `SELECT therapy_modality FROM entries GROUP BY therapy_modality
       ORDER BY COUNT(*) DESC LIMIT 1`,
    ).first<{ therapy_modality: string }>();

    const result = await searchEntries(env.DB, modalityRow!.therapy_modality, 1, EMPTY_FACET_FILTERS, {
      forceLike: true,
    });
    expect(result.mode).toBe("like");
    expect(result.total).toBeGreaterThan(0);
  });

  it("serves the search page HTML for a real query and labels blocked hits", async () => {
    const blocked = await env.DB.prepare(
      "SELECT title FROM entries WHERE link_status = 'blocked' LIMIT 1",
    ).first<{ title: string }>();
    const firstWord = blocked!.title.split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]/g, "");
    if (!firstWord || firstWord.length < 2) return;

    const ctx = createExecutionContext();
    const res = await app.request(
      `/psychotherapy/search?q=${encodeURIComponent(firstWord)}`,
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("link inconclusive");
  });
});
