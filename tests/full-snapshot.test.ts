import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import fullSnapshotSql from "../fixtures/full_snapshot.sql?raw";
import fullSnapshotManifest from "../fixtures/full_snapshot.manifest.json";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";
import { getEntriesByIds, getKindCounts, getManifest, getRelatedEntries, getTagCounts, searchEntries } from "../src/db/repository";
import { EMPTY_FACET_FILTERS } from "../src/db/facets";
import { STATIC_SITEMAP_PATHS } from "../src/sitemap";
import { CONTRACT_VERSION } from "../src/contract";

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

  it("gives every entry a non-null, contract-valid audience value (Phase 2A)", async () => {
    const rows = await env.DB.prepare(
      "SELECT audience, COUNT(*) AS c FROM entries GROUP BY audience",
    ).all<{ audience: string | null; c: number }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const { audience } of rows.results) {
      expect(audience).not.toBeNull();
      expect(["client", "clinician", "unknown"]).toContain(audience);
    }
  });

  it("populates entry_neighbors with valid, self-excluding references for every entry (Phase 2A)", async () => {
    const entryCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries",
    ).first<{ c: number }>();
    const neighborCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entry_neighbors",
    ).first<{ c: number }>();
    expect(neighborCount?.c).toBeGreaterThan(0);
    // Every embedded entry gets up to 10 neighbors; total rows must not
    // exceed 10x the entry count.
    expect(neighborCount?.c).toBeLessThanOrEqual((entryCount?.c ?? 0) * 10);

    const selfReferencing = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entry_neighbors WHERE entry_id = neighbor_id",
    ).first<{ c: number }>();
    expect(selfReferencing?.c).toBe(0);

    const danglingEntryRefs = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM entry_neighbors n
       LEFT JOIN entries e ON e.id = n.entry_id
       WHERE e.id IS NULL`,
    ).first<{ c: number }>();
    expect(danglingEntryRefs?.c).toBe(0);

    const danglingNeighborRefs = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM entry_neighbors n
       LEFT JOIN entries e ON e.id = n.neighbor_id
       WHERE e.id IS NULL`,
    ).first<{ c: number }>();
    expect(danglingNeighborRefs?.c).toBe(0);
  });

  it("stores coverage_json audience/neighbors breakdowns matching recomputed totals (Phase 2A)", async () => {
    const row = await env.DB.prepare(
      "SELECT coverage_json FROM snapshot_manifest WHERE id = 1",
    ).first<{ coverage_json: string }>();
    const coverage = JSON.parse(row!.coverage_json) as {
      audience: Record<string, number>;
      neighbors: { entries_with_neighbors: number; entries_missing_embeddings: number };
      authors_structured_count: number;
    };

    const audienceRows = await env.DB.prepare(
      "SELECT audience, COUNT(*) AS c FROM entries GROUP BY audience",
    ).all<{ audience: string; c: number }>();
    for (const { audience, c } of audienceRows.results) {
      expect(coverage.audience[audience]).toBe(c);
    }

    const entriesWithNeighbors = await env.DB.prepare(
      "SELECT COUNT(DISTINCT entry_id) AS c FROM entry_neighbors",
    ).first<{ c: number }>();
    expect(coverage.neighbors.entries_with_neighbors).toBe(
      entriesWithNeighbors?.c,
    );
    expect(coverage.neighbors.entries_missing_embeddings).toBe(0);

    const authorsCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries WHERE authors_json IS NOT NULL",
    ).first<{ c: number }>();
    expect(coverage.authors_structured_count).toBe(authorsCount?.c);
  });

  it("surfaces coverage_json as a typed object via getManifest (Phase 1E)", async () => {
    const manifest = await getManifest(env.DB);
    expect(manifest).not.toBeNull();
    expect(manifest?.coverage_json.total_entries).toBe(
      fullSnapshotManifest.coverage_json.total_entries,
    );
    expect(manifest?.coverage_json.modalities).toEqual(
      fullSnapshotManifest.coverage_json.modalities,
    );
    expect(manifest?.coverage_json.verifications.identity).toEqual(
      fullSnapshotManifest.coverage_json.verifications.identity,
    );
  });

  it("paginates search results with working Next/Previous links (Phase 1E)", async () => {
    // "act" prefix-matches thousands of rows in the real corpus -- the
    // synthetic 12-row spike fixture used elsewhere never exceeds one page,
    // so real Prev/Next rendering can only be proven against this dataset.
    const page1Ctx = createExecutionContext();
    const page1Res = await app.request(
      "/psychotherapy/search?q=act",
      {},
      env,
      page1Ctx,
    );
    await waitOnExecutionContext(page1Ctx);
    expect(page1Res.status).toBe(200);
    const page1Html = await page1Res.text();
    expect(page1Html).toContain("Page 1 of");
    expect(page1Html).toContain(">Next<");
    expect(page1Html).toContain(">Last<");
    expect(page1Html).not.toContain(">Previous<");
    expect(page1Html).not.toContain(">First<");

    const page2Ctx = createExecutionContext();
    const page2Res = await app.request(
      "/psychotherapy/search?q=act&page=2",
      {},
      env,
      page2Ctx,
    );
    await waitOnExecutionContext(page2Ctx);
    expect(page2Res.status).toBe(200);
    const page2Html = await page2Res.text();
    expect(page2Html).toContain("Page 2 of");
    expect(page2Html).toContain(">Next<");
    expect(page2Html).toContain(">Previous<");
    expect(page2Html).toContain(">Last<");
    expect(page2Html).not.toContain(">First<");
    expect(page2Html).not.toBe(page1Html);

    const page3Ctx = createExecutionContext();
    const page3Res = await app.request(
      "/psychotherapy/search?q=act&page=3",
      {},
      env,
      page3Ctx,
    );
    await waitOnExecutionContext(page3Ctx);
    expect(page3Res.status).toBe(200);
    const page3Html = await page3Res.text();
    expect(page3Html).toContain("Page 3 of");
    expect(page3Html).toContain(">First<");
    expect(page3Html).toContain(">Previous<");
    expect(page3Html).toContain(">Next<");
    expect(page3Html).toContain(">Last<");
  });

  it("serves a full sitemap.xml under the 50,000-URL single-sitemap limit (Phase 1F)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/sitemap.xml", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const xml = await res.text();
    const urlCount = (xml.match(/<url>/g) ?? []).length;
    expect(urlCount).toBe(STATIC_SITEMAP_PATHS.length + fullSnapshotManifest.entry_count);
    expect(urlCount).toBeLessThan(50_000);
    expect(xml).toContain("/psychotherapy/topics");
    expect(xml).toContain("/psychotherapy/hexaflex");
  });

  it("returns getRelatedEntries() results matching a raw entry_neighbors query, in rank order (Phase 2C)", async () => {
    const sample = await env.DB.prepare(
      `SELECT entry_id, COUNT(*) AS c FROM entry_neighbors
       GROUP BY entry_id ORDER BY c DESC LIMIT 1`,
    ).first<{ entry_id: string; c: number }>();
    expect(sample).not.toBeNull();

    const rawRows = (
      await env.DB.prepare(
        `SELECT e.id, e.title, e.therapy_modality, e.link_status
         FROM entry_neighbors n
         JOIN entries e ON e.id = n.neighbor_id
         WHERE n.entry_id = ?
         ORDER BY n.rank ASC`,
      )
        .bind(sample!.entry_id)
        .all<{ id: string; title: string; therapy_modality: string; link_status: string }>()
    ).results;

    const related = await getRelatedEntries(env.DB, sample!.entry_id);
    expect(related).toEqual(rawRows);
    expect(related.length).toBe(sample!.c);
  });

  it("batch-fetches a real 50-id shortlist in request order, matching individual lookups (Phase 2D)", async () => {
    const sample = (
      await env.DB.prepare(`SELECT id FROM entries ORDER BY id LIMIT 50`).all<{ id: string }>()
    ).results.map((r) => r.id);
    expect(sample.length).toBe(50);

    // Deliberately reversed so a naive `ORDER BY id` in the batched query
    // would fail this — order must come from the request, not from SQL.
    const requested = [...sample].reverse();
    const { entries, missingIds } = await getEntriesByIds(env.DB, requested);
    expect(missingIds).toEqual([]);
    expect(entries.map((e) => e.id)).toEqual(requested);

    for (const id of [requested[0], requested[25], requested[49]]) {
      const row = await env.DB.prepare(`SELECT title FROM entries WHERE id = ?`)
        .bind(id)
        .first<{ title: string }>();
      const entry = entries.find((e) => e.id === id);
      expect(entry?.title).toBe(row?.title);
    }
  });

  it("sums modality facet counts to the total entry count (Phase 2B)", async () => {
    const result = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS);
    expect(result.mode).toBe("empty");
    const sum = result.facets.modality.reduce((acc, o) => acc + o.count, 0);
    expect(sum).toBe(fullSnapshotManifest.entry_count);
    expect(result.facets.modality.length).toBe(21);
  });

  it("filters browse results to exactly the paywalled oa_status set (Phase 2B)", async () => {
    const result = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      access: ["paywalled"],
    });
    expect(result.mode).toBe("browse");
    expect(result.total).toBeGreaterThan(0);

    const closedCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries WHERE oa_status = 'closed'",
    ).first<{ c: number }>();
    expect(result.total).toBe(closedCount?.c);

    for (const hit of result.hits) {
      const row = await env.DB.prepare("SELECT oa_status FROM entries WHERE id = ?")
        .bind(hit.id)
        .first<{ oa_status: string | null }>();
      expect(row?.oa_status).toBe("closed");
    }
  });

  it("still paginates correctly when a broad text query is combined with a facet filter (Phase 2B)", async () => {
    const unfiltered = await searchEntries(env.DB, "act", 1, EMPTY_FACET_FILTERS);
    const filtered = await searchEntries(env.DB, "act", 1, {
      ...EMPTY_FACET_FILTERS,
      audience: ["clinician"],
    });
    expect(filtered.mode).toBe("fts");
    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(unfiltered.total);

    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/search?q=act&audience=clinician",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain("Page 1 of");
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

  it("splits the corpus into literature (papers) and materials (Phase 2.5A)", async () => {
    const counts = await getKindCounts(env.DB);
    expect(counts.literature + counts.materials).toBe(fullSnapshotManifest.entry_count);
    expect(counts.literature).toBeGreaterThan(counts.materials);

    const paperCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM entries WHERE resource_type = 'paper'",
    ).first<{ c: number }>();
    expect(counts.literature).toBe(paperCount?.c);

    const literature = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      kind: "literature",
    });
    expect(literature.mode).toBe("browse");
    expect(literature.total).toBe(counts.literature);
    expect(literature.hits.every((h) => h.resource_type === "paper")).toBe(true);
    expect(literature.hits[0]?.published_date !== undefined).toBe(true);
    expect(literature.hits[0]?.audience).toBeTruthy();

    const materials = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      kind: "materials",
    });
    expect(materials.mode).toBe("browse");
    expect(materials.total).toBe(counts.materials);
    expect(materials.hits.some((h) => h.resource_type === "paper")).toBe(false);
  });

  it("renders literature and materials doors with live counts on the home page (Phase 2.5A)", async () => {
    const counts = await getKindCounts(env.DB);
    const ctx = createExecutionContext();
    const res = await app.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain("/psychotherapy/search?kind=literature");
    expect(html).toContain("/psychotherapy/search?kind=materials");
    expect(html).toContain(`${counts.literature.toLocaleString()} papers`);
    expect(html).toContain(`${counts.materials.toLocaleString()} resources`);
    expect(html).toContain("Search everything");
  });

  it("exposes topic/hexaflex/type/decade facets within each corpus (Phase 2.5B)", async () => {
    const topicNames = new Set([
      "anxiety",
      "bpd",
      "depression",
      "emotion_dysregulation",
      "ocd",
      "relationships",
      "schema_adjacent",
      "self_compassion",
      "sleep",
      "substance_use",
      "suicidality",
      "trauma",
    ]);
    const hexaflexNames = new Set([
      "acceptance",
      "committed_action",
      "defusion",
      "present_moment",
      "self_as_context",
      "values",
    ]);
    const decadeNames = new Set(["2020s", "2010s", "2000s", "pre-2000"]);

    const literature = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      kind: "literature",
    });
    expect(literature.facets.topic.every((o) => topicNames.has(o.value))).toBe(true);
    expect(literature.facets.hexaflex.every((o) => hexaflexNames.has(o.value))).toBe(true);
    expect(literature.facets.decade.length).toBeGreaterThan(0);
    expect(literature.facets.decade.every((o) => decadeNames.has(o.value))).toBe(true);

    const twenties = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      kind: "literature",
      decade: ["2020s"],
    });
    expect(twenties.mode).toBe("browse");
    expect(twenties.total).toBeGreaterThan(0);
    expect(
      twenties.hits.every((h) => {
        const date = h.published_date;
        return date != null && date >= "2020" && date < "2030";
      }),
    ).toBe(true);

    const materials = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      kind: "materials",
    });
    expect(materials.facets.type.some((o) => o.value === "paper")).toBe(false);
    expect(materials.facets.topic.every((o) => topicNames.has(o.value))).toBe(true);
    expect(materials.facets.hexaflex.every((o) => hexaflexNames.has(o.value))).toBe(true);

    const handouts = await searchEntries(env.DB, "", 1, {
      ...EMPTY_FACET_FILTERS,
      kind: "materials",
      type: ["handout"],
    });
    expect(handouts.mode).toBe("browse");
    expect(handouts.total).toBeGreaterThan(0);
    expect(handouts.hits.every((h) => h.resource_type === "handout")).toBe(true);
  });

  it("renders topic and hexaflex directory landings that emit search URLs (Phase 2.5C)", async () => {
    const hexaflexNames = new Set([
      "acceptance",
      "committed_action",
      "defusion",
      "present_moment",
      "self_as_context",
      "values",
    ]);

    const topicCounts = await getTagCounts(env.DB, "topic");
    expect(topicCounts.length).toBeGreaterThan(0);

    const topicCtx = createExecutionContext();
    const topicRes = await app.request("/psychotherapy/topics", {}, env, topicCtx);
    await waitOnExecutionContext(topicCtx);
    const topicHtml = await topicRes.text();
    const topicHrefs = [...topicHtml.matchAll(/href="(\/psychotherapy\/search\?topic=[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(topicHrefs.length).toBe(topicCounts.length);
    expect(topicHrefs.every((href) => href.startsWith("/psychotherapy/search?topic="))).toBe(true);
    expect(topicHrefs.some((href) => href.includes("kind="))).toBe(false);

    const hexCounts = await getTagCounts(env.DB, "hexaflex");
    expect(hexCounts.length).toBeGreaterThan(0);
    expect(hexCounts.every((t) => hexaflexNames.has(t.name))).toBe(true);

    const hexCtx = createExecutionContext();
    const hexRes = await app.request("/psychotherapy/hexaflex", {}, env, hexCtx);
    await waitOnExecutionContext(hexCtx);
    const hexHtml = await hexRes.text();
    const hexHrefs = [...hexHtml.matchAll(/href="(\/psychotherapy\/search\?[^"]+)"/g)].map(
      (m) => m[1].replaceAll("&amp;", "&"),
    );
    const processHrefs = hexHrefs.filter((href) => href.includes("hexaflex="));
    expect(processHrefs.length).toBe(hexCounts.length);
    expect(processHrefs.every((href) => href.includes("kind=materials"))).toBe(true);
  });

  it("treats ?like= as a neighbors search matching getRelatedEntries order (Phase 2.5D)", async () => {
    const sample = await env.DB.prepare(
      `SELECT entry_id, COUNT(*) AS c FROM entry_neighbors
       GROUP BY entry_id HAVING c = 10 LIMIT 1`,
    ).first<{ entry_id: string; c: number }>();
    expect(sample).not.toBeNull();
    expect(sample!.c).toBe(10);
    expect(CONTRACT_VERSION).toBe("1.2");

    const related = await getRelatedEntries(env.DB, sample!.entry_id);
    const result = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS, {
      likeId: sample!.entry_id,
    });
    expect(result.mode).toBe("neighbors");
    expect(result.likeId).toBe(sample!.entry_id);
    expect(result.total).toBe(10);
    expect(result.hits.map((h) => h.id)).toEqual(related.map((r) => r.id));
  });
});
