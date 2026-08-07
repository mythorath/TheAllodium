import { env } from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import fullSnapshotSql from "../fixtures/full_snapshot.sql?raw";
import fullSnapshotManifest from "../fixtures/full_snapshot.manifest.json";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";

/**
 * Phase 1D: validates the complete 5,643-row deterministic snapshot -- the
 * one thing that genuinely requires a real SQLite/D1 engine (FTS-parity
 * after rebuild). Everything else about the snapshot (duplicate ids/urls,
 * orphaned references, forbidden substrings) is checked by
 * validate_snapshot() in ACT before this file is ever generated -- see
 * export_allodium_snapshot.py. This suite is intentionally separate from the
 * fast spike/staging-sample suites since it's the largest dataset.
 */

async function loadFullSnapshot() {
  await execStatements(env.DB, fullSnapshotSql);
  await execStatements(env.DB, ftsSql);
}

describe("full snapshot (complete 5,643-row corpus) - integrity", () => {
  beforeAll(async () => {
    await loadFullSnapshot();
  }, 60_000);

  it("loads every entry from the full corpus, not a sample", async () => {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries",
    ).first<{ c: number }>();
    expect(row?.c).toBe(fullSnapshotManifest.entry_count);
    expect(row?.c).toBeGreaterThan(5000);
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

  it("stores a coverage_json manifest column that matches recomputed spot totals", async () => {
    const row = await env.DB.prepare(
      "SELECT coverage_json FROM snapshot_manifest WHERE id = 1",
    ).first<{ coverage_json: string }>();
    expect(row?.coverage_json).toBeTruthy();
    const coverage = JSON.parse(row!.coverage_json) as {
      total_entries: number;
      link_status: Record<string, number>;
      modalities: Record<string, number>;
    };

    const entryCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries",
    ).first<{ c: number }>();
    expect(coverage.total_entries).toBe(entryCount?.c);

    const linkStatusRows = await env.DB.prepare(
      "SELECT link_status, COUNT(*) AS c FROM entries GROUP BY link_status",
    ).all<{ link_status: string; c: number }>();
    for (const { link_status, c } of linkStatusRows.results) {
      expect(coverage.link_status[link_status]).toBe(c);
    }

    const modalityRows = await env.DB.prepare(
      "SELECT therapy_modality, COUNT(*) AS c FROM entries GROUP BY therapy_modality",
    ).all<{ therapy_modality: string; c: number }>();
    expect(modalityRows.results.length).toBe(21);
    for (const { therapy_modality, c } of modalityRows.results) {
      expect(coverage.modalities[therapy_modality]).toBe(c);
    }
  });

  it("matches the manifest's row-set checksum and row counts", async () => {
    const manifestRow = await env.DB.prepare(
      "SELECT checksum, entry_count, tag_link_count, alias_count FROM snapshot_manifest WHERE id = 1",
    ).first<{
      checksum: string;
      entry_count: number;
      tag_link_count: number;
      alias_count: number;
    }>();
    expect(manifestRow?.checksum).toBe(fullSnapshotManifest.checksum);
    expect(manifestRow?.entry_count).toBe(fullSnapshotManifest.entry_count);
    expect(manifestRow?.tag_link_count).toBe(fullSnapshotManifest.tag_link_count);
    expect(manifestRow?.alias_count).toBe(fullSnapshotManifest.alias_count);
  });
});
