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
  getEntriesByIds,
  getEntry,
  getManifest,
  getRelatedEntries,
  parseShortlistIds,
  resolveCanonicalId,
  getTagCounts,
} from "../src/db/repository";
import { EMPTY_FACET_FILTERS, buildFacetWhere, hasActiveFilters, parseFacetFilters } from "../src/db/facets";
import type { FacetFilters } from "../src/db/facets";
import { DEFAULT_SORT, parseSortOption, sortOrderBy } from "../src/db/sort";
import type { SortOption } from "../src/db/sort";
import fixtureSql from "../fixtures/spike_fixture.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";
import { SITE_URL } from "../src/site-config";
import { STATIC_SITEMAP_PATHS } from "../src/sitemap";
import { collectionForPath } from "../src/collections";

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

describe("shortlist id parsing (Phase 2D)", () => {
  it("splits on commas, trims whitespace, dedupes, and drops empties", () => {
    expect(parseShortlistIds("aaa, bbb ,, aaa ,ccc")).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("returns an empty array for null or blank input", () => {
    expect(parseShortlistIds(null)).toEqual([]);
    expect(parseShortlistIds("")).toEqual([]);
    expect(parseShortlistIds("   ")).toEqual([]);
  });

  it("caps at the given limit, keeping the earliest-listed ids", () => {
    const many = Array.from({ length: 60 }, (_, i) => `id${i}`).join(",");
    const ids = parseShortlistIds(many, 50);
    expect(ids.length).toBe(50);
    expect(ids[0]).toBe("id0");
    expect(ids[49]).toBe("id49");
  });

  it("defaults the cap to 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => `id${i}`).join(",");
    expect(parseShortlistIds(many).length).toBe(50);
  });
});

describe("facet filter parsing and WHERE building", () => {
  function getAllFrom(params: Record<string, string[]>) {
    return (name: string) => params[name];
  }

  it("reads repeated params per dimension", () => {
    const filters = parseFacetFilters(
      getAllFrom({
        modality: ["cbt", "act"],
        audience: ["client"],
        access: ["free"],
        storage: ["stored"],
        link_status: ["ok", "blocked"],
      }),
    );
    expect(filters).toEqual({
      ...EMPTY_FACET_FILTERS,
      modality: ["cbt", "act"],
      audience: ["client"],
      access: ["free"],
      storage: ["stored"],
      linkStatus: ["ok", "blocked"],
    });
  });

  it("defaults every dimension to empty when params are absent", () => {
    expect(parseFacetFilters(getAllFrom({}))).toEqual(EMPTY_FACET_FILTERS);
  });

  it("drops values outside the allowlist for enum dimensions, but not modality (free text)", () => {
    const filters = parseFacetFilters(
      getAllFrom({
        audience: ["client", "not-a-real-audience"],
        access: ["free", "bogus"],
        link_status: ["ok", "bogus"],
        modality: ["anything-goes"],
      }),
    );
    expect(filters.audience).toEqual(["client"]);
    expect(filters.access).toEqual(["free"]);
    expect(filters.linkStatus).toEqual(["ok"]);
    expect(filters.modality).toEqual(["anything-goes"]);
  });

  it("dedupes and caps the number of values per dimension", () => {
    const many = Array.from({ length: 40 }, (_, i) => `modality-${i}`);
    const filters = parseFacetFilters(getAllFrom({ modality: [...many, ...many] }));
    expect(filters.modality.length).toBe(25);
    expect(new Set(filters.modality).size).toBe(25);
  });

  it("builds no WHERE clause when nothing is active", () => {
    expect(buildFacetWhere(EMPTY_FACET_FILTERS)).toEqual({ sql: "", binds: [] });
  });

  it("builds an IN clause for simple dimensions and ANDs across dimensions", () => {
    const { sql, binds } = buildFacetWhere({
      ...EMPTY_FACET_FILTERS,
      modality: ["cbt", "act"],
      linkStatus: ["ok"],
    });
    expect(sql).toBe("e.therapy_modality IN (?, ?) AND e.link_status IN (?)");
    expect(binds).toEqual(["cbt", "act", "ok"]);
  });

  it("excludes only the named dimension's own filter", () => {
    const filters: FacetFilters = {
      ...EMPTY_FACET_FILTERS,
      modality: ["cbt"],
      audience: ["client"],
    };
    const { sql, binds } = buildFacetWhere(filters, "modality");
    expect(sql).toBe("e.audience IN (?)");
    expect(binds).toEqual(["client"]);
  });

  it("maps access/storage to their derived oa_status/is_link_only conditions", () => {
    const access = buildFacetWhere({ ...EMPTY_FACET_FILTERS, access: ["free", "paywalled"] });
    expect(access.sql).toBe(
      "((e.oa_status IS NOT NULL AND e.oa_status != 'closed') OR e.oa_status = 'closed')",
    );
    const storage = buildFacetWhere({ ...EMPTY_FACET_FILTERS, storage: ["link_only"] });
    expect(storage.sql).toBe("(e.is_link_only = 1)");
  });

  it("parses exclusive kind and maps it to resource_type (Phase 2.5A)", () => {
    expect(parseFacetFilters(getAllFrom({ kind: ["literature"] })).kind).toBe("literature");
    expect(parseFacetFilters(getAllFrom({ kind: ["materials"] })).kind).toBe("materials");
    expect(parseFacetFilters(getAllFrom({ kind: [""] })).kind).toBeNull();
    expect(parseFacetFilters(getAllFrom({ kind: ["bogus"] })).kind).toBeNull();
    expect(parseFacetFilters(getAllFrom({ kind: ["materials", "literature"] })).kind).toBe(
      "materials",
    );

    expect(buildFacetWhere({ ...EMPTY_FACET_FILTERS, kind: "literature" })).toEqual({
      sql: "e.resource_type = 'paper'",
      binds: [],
    });
    expect(buildFacetWhere({ ...EMPTY_FACET_FILTERS, kind: "materials" })).toEqual({
      sql: "e.resource_type != 'paper'",
      binds: [],
    });
    expect(hasActiveFilters({ ...EMPTY_FACET_FILTERS, kind: "literature" })).toBe(true);
    expect(hasActiveFilters(EMPTY_FACET_FILTERS)).toBe(false);

    const both = buildFacetWhere({
      ...EMPTY_FACET_FILTERS,
      kind: "literature",
      audience: ["clinician"],
    });
    expect(both.sql).toBe("e.resource_type = 'paper' AND e.audience IN (?)");
    expect(buildFacetWhere({ ...EMPTY_FACET_FILTERS, kind: "literature" }, "kind")).toEqual({
      sql: "",
      binds: [],
    });
  });

  it("parses topic/hexaflex/type/decade and maps them to SQL (Phase 2.5B)", () => {
    const parsed = parseFacetFilters(
      getAllFrom({
        topic: ["depression", "anxiety"],
        hexaflex: ["values"],
        type: ["handout"],
        decade: ["2010s", "bogus", "2020s"],
      }),
    );
    expect(parsed.topic).toEqual(["depression", "anxiety"]);
    expect(parsed.hexaflex).toEqual(["values"]);
    expect(parsed.type).toEqual(["handout"]);
    expect(parsed.decade).toEqual(["2010s", "2020s"]);
    expect(parseFacetFilters(getAllFrom({ decade: ["not-a-decade"] })).decade).toEqual([]);

    const topic = buildFacetWhere({ ...EMPTY_FACET_FILTERS, topic: ["depression"] });
    expect(topic.sql).toBe(
      "EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.category = ? AND t.name IN (?))",
    );
    expect(topic.binds).toEqual(["topic", "depression"]);

    const hexaflex = buildFacetWhere({ ...EMPTY_FACET_FILTERS, hexaflex: ["values", "defusion"] });
    expect(hexaflex.sql).toContain("t.category = ? AND t.name IN (?, ?)");
    expect(hexaflex.binds).toEqual(["hexaflex", "values", "defusion"]);

    const type = buildFacetWhere({ ...EMPTY_FACET_FILTERS, type: ["handout", "worksheet"] });
    expect(type).toEqual({
      sql: "e.resource_type IN (?, ?)",
      binds: ["handout", "worksheet"],
    });

    const decade = buildFacetWhere({ ...EMPTY_FACET_FILTERS, decade: ["2010s"] });
    expect(decade.sql).toBe("((e.published_date >= '2010' AND e.published_date < '2020'))");
    expect(decade.binds).toEqual([]);

    const twoDecades = buildFacetWhere({ ...EMPTY_FACET_FILTERS, decade: ["2020s", "pre-2000"] });
    expect(twoDecades.sql).toContain("e.published_date >= '2020'");
    expect(twoDecades.sql).toContain("e.published_date < '2000'");

    expect(hasActiveFilters({ ...EMPTY_FACET_FILTERS, topic: ["depression"] })).toBe(true);
    expect(buildFacetWhere({ ...EMPTY_FACET_FILTERS, topic: ["depression"] }, "topic")).toEqual({
      sql: "",
      binds: [],
    });
  });
});

describe("sort option parsing and ORDER BY fragments", () => {
  it("defaults unknown/absent values to relevance", () => {
    expect(parseSortOption(undefined)).toBe(DEFAULT_SORT);
    expect(parseSortOption(null)).toBe("relevance");
    expect(parseSortOption("")).toBe("relevance");
    expect(parseSortOption("not-a-sort")).toBe("relevance");
  });

  it("accepts every allowlisted sort value case-insensitively", () => {
    const expected: SortOption[] = [
      "relevance",
      "date_desc",
      "date_asc",
      "title_asc",
      "citations_desc",
    ];
    for (const opt of expected) {
      expect(parseSortOption(opt)).toBe(opt);
      expect(parseSortOption(opt.toUpperCase())).toBe(opt);
    }
  });

  it("puts NULLs last for date/citation sorts, falls back to title without a score, and always ends in a unique e.id tiebreaker", () => {
    expect(sortOrderBy("relevance", true)).toBe("score ASC, e.title ASC, e.id ASC");
    expect(sortOrderBy("relevance", false)).toBe("e.title ASC, e.id ASC");
    expect(sortOrderBy("date_desc", false)).toBe(
      "e.published_date IS NULL, e.published_date DESC, e.title ASC, e.id ASC",
    );
    expect(sortOrderBy("date_asc", false)).toBe(
      "e.published_date IS NULL, e.published_date ASC, e.title ASC, e.id ASC",
    );
    expect(sortOrderBy("title_asc", true)).toBe("e.title ASC, e.id ASC");
    expect(sortOrderBy("citations_desc", false)).toBe(
      "e.citation_count IS NULL, e.citation_count DESC, e.title ASC, e.id ASC",
    );
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

  it("parses audience and structured authors_json onto the public entry (Phase 2A)", async () => {
    const paper = await getEntry(env.DB, "bbbbbbbb00000003");
    expect(paper?.audience).toBe("clinician");
    expect(paper?.authors).toEqual([
      { name: "C. Researcher", orcid: null, institution: null, position: "first" },
      { name: "D. Colleague", orcid: null, institution: null, position: "last" },
    ]);

    const worksheet = await getEntry(env.DB, "aaaaaaaa00000001");
    expect(worksheet?.audience).toBe("client");
    expect(worksheet?.authors).toBeNull();
  });

  it("exposes overview when present and null otherwise (contract v1.2)", async () => {
    const withOverview = await getEntry(env.DB, "aaaaaaaa00000001");
    expect(withOverview?.overview).toMatch(/personal values/);

    const withoutOverview = await getEntry(env.DB, "aaaaaaaa00000002");
    expect(withoutOverview?.overview).toBeNull();

    const ctx = createExecutionContext();
    const response = await app.request("/psychotherapy/entries/aaaaaaaa00000001", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const html = await response.text();
    expect(html).toContain("Overview");
    expect(html).toContain("AI-generated summary");
    expect(html).toContain("personal values");
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/);
  });

  it("degrades to null authors rather than throwing on malformed authors_json", async () => {
    await env.DB.prepare(`UPDATE entries SET authors_json = ? WHERE id = ?`)
      .bind("not valid json", "bbbbbbbb00000004")
      .run();

    const entry = await getEntry(env.DB, "bbbbbbbb00000004");
    expect(entry?.authors).toBeNull();
  });

  it("returns rank-ordered related entries from entry_neighbors (Phase 2C)", async () => {
    const related = await getRelatedEntries(env.DB, "aaaaaaaa00000001");
    expect(related).toEqual([
      { id: "aaaaaaaa00000002", title: "Defusion Techniques for Anxiety", therapy_modality: "act", link_status: "ok" },
      {
        id: "bbbbbbbb00000003",
        title: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
        therapy_modality: "act",
        link_status: "ok",
      },
    ]);
  });

  it("gives an honest empty array for an entry with no computed neighbors (Phase 2C)", async () => {
    const related = await getRelatedEntries(env.DB, "dddddddd00000007");
    expect(related).toEqual([]);
  });

  it("fetches multiple entries in request order, resolving aliases and reporting unresolvable ids (Phase 2D)", async () => {
    const { entries, missingIds } = await getEntriesByIds(env.DB, [
      "bbbbbbbb00000003",
      "retired000000001", // alias -> aaaaaaaa00000001
      "doesnotexist0000",
    ]);
    expect(entries.map((e) => e.id)).toEqual(["bbbbbbbb00000003", "aaaaaaaa00000001"]);
    expect(missingIds).toEqual(["doesnotexist0000"]);
    // Full PublicEntry shape (tags/verifications included), not a slim projection.
    expect(entries[0].doi).toBe("10.1000/act.depression.meta");
    expect(entries[0].tags.length).toBeGreaterThan(0);
    expect(entries[1].title).toBe("Values Clarification Worksheet");
  });

  it("dedupes when a canonical id and its own alias are both requested (Phase 2D)", async () => {
    const { entries, missingIds } = await getEntriesByIds(env.DB, [
      "aaaaaaaa00000001",
      "retired000000001",
    ]);
    expect(entries.map((e) => e.id)).toEqual(["aaaaaaaa00000001"]);
    expect(missingIds).toEqual([]);
  });

  it("returns empty results for an empty id list without querying (Phase 2D)", async () => {
    expect(await getEntriesByIds(env.DB, [])).toEqual({ entries: [], missingIds: [] });
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
    const result = await searchEntries(env.DB, "defusion", 1, EMPTY_FACET_FILTERS, {
      forceLike: true,
    });
    expect(result.mode).toBe("like");
    expect(result.hits.some((h) => h.id === "aaaaaaaa00000002")).toBe(true);

    const abstractLeak = await searchEntries(env.DB, "SYNTHETIC ABSTRACT", 1, EMPTY_FACET_FILTERS, {
      forceLike: true,
    });
    expect(abstractLeak.total).toBe(0);
  });

  describe("Phase 2B facets", () => {
    function filters(overrides: Partial<FacetFilters>): FacetFilters {
      return { ...EMPTY_FACET_FILTERS, ...overrides };
    }

    it("browses with a single-dimension filter and no text query (first-class, not an error)", async () => {
      const result = await searchEntries(env.DB, "", 1, filters({ modality: ["cbt"] }));
      expect(result.mode).toBe("browse");
      expect(result.total).toBe(2);
      expect(result.hits.map((h) => h.id).sort()).toEqual([
        "bbbbbbbb00000004",
        "eeeeeeee00000009",
      ]);
    });

    it("ORs multiple values within the same dimension", async () => {
      const result = await searchEntries(
        env.DB,
        "",
        1,
        filters({ modality: ["cbt", "act"] }),
      );
      expect(result.mode).toBe("browse");
      expect(result.total).toBe(5); // 3 act + 2 cbt
    });

    it("ANDs filters across dimensions", async () => {
      const result = await searchEntries(
        env.DB,
        "",
        1,
        filters({ modality: ["act"], audience: ["clinician"] }),
      );
      expect(result.mode).toBe("browse");
      expect(result.hits.map((h) => h.id)).toEqual(["bbbbbbbb00000003"]);
    });

    it("combines a text query with a facet filter", async () => {
      const both = await searchEntries(
        env.DB,
        "depression",
        1,
        filters({ modality: ["ba"] }),
      );
      expect(both.total).toBe(1);
      expect(both.hits[0]?.id).toBe("cccccccc00000006");

      const excluded = await searchEntries(
        env.DB,
        "depression",
        1,
        filters({ audience: ["client"] }),
      );
      expect(excluded.total).toBe(0);
    });

    it("shows no result-set entries with oa_status null under an access filter", async () => {
      const free = await searchEntries(env.DB, "", 1, filters({ access: ["free"] }));
      expect(free.total).toBe(2); // gold (bbbbbbbb3) + green (cccccccc6)

      const paywalled = await searchEntries(env.DB, "", 1, filters({ access: ["paywalled"] }));
      expect(paywalled.total).toBe(1); // closed (eeeeeeee9)
    });

    it("sorts browse results by title, date, and citations (NULLs last)", async () => {
      const cbt = filters({ modality: ["cbt"] });

      const byTitle = await searchEntries(env.DB, "", 1, cbt, { sort: "title_asc" });
      expect(byTitle.sort).toBe("title_asc");
      expect(byTitle.hits.map((h) => h.id)).toEqual([
        "eeeeeeee00000009", // "Closed Access…"
        "bbbbbbbb00000004", // "Cognitive Restructuring…"
      ]);

      const newest = await searchEntries(env.DB, "", 1, cbt, { sort: "date_desc" });
      expect(newest.hits.map((h) => h.id)).toEqual([
        "eeeeeeee00000009", // 2023
        "bbbbbbbb00000004", // NULL published_date → last
      ]);

      const oldest = await searchEntries(env.DB, "", 1, cbt, { sort: "date_asc" });
      expect(oldest.hits.map((h) => h.id)).toEqual([
        "eeeeeeee00000009",
        "bbbbbbbb00000004",
      ]);

      const cited = await searchEntries(env.DB, "", 1, cbt, { sort: "citations_desc" });
      expect(cited.hits.map((h) => h.id)).toEqual([
        "eeeeeeee00000009", // citation_count 5
        "bbbbbbbb00000004", // NULL citation_count → last
      ]);
    });

    it("lets an explicit sort override FTS relevance ranking", async () => {
      const relevance = await searchEntries(env.DB, "depression", 1, EMPTY_FACET_FILTERS, {
        sort: "relevance",
      });
      expect(relevance.mode).toBe("fts");
      expect(relevance.sort).toBe("relevance");

      const byCitations = await searchEntries(env.DB, "depression", 1, EMPTY_FACET_FILTERS, {
        sort: "citations_desc",
      });
      expect(byCitations.mode).toBe("fts");
      expect(byCitations.hits.map((h) => h.id)).toEqual([
        "bbbbbbbb00000003", // 42 citations
        "cccccccc00000006", // 18 citations
      ]);

      const newest = await searchEntries(env.DB, "depression", 1, EMPTY_FACET_FILTERS, {
        sort: "date_desc",
      });
      expect(newest.hits.map((h) => h.id)).toEqual([
        "bbbbbbbb00000003", // 2021
        "cccccccc00000006", // 2017
      ]);
    });

    it("computes cross-filtered facet counts that exclude a dimension's own filter", async () => {
      const result = await searchEntries(env.DB, "", 1, filters({ audience: ["clinician"] }));

      // The audience dimension itself must show BOTH values (client and
      // clinician), not just the one currently selected — that's what makes
      // switching between them possible without starting over.
      const audienceOptions = Object.fromEntries(
        result.facets.audience.map((o) => [o.value, o]),
      );
      expect(audienceOptions.client?.count).toBe(7);
      expect(audienceOptions.clinician?.count).toBe(5);
      expect(audienceOptions.clinician?.selected).toBe(true);
      expect(audienceOptions.client?.selected).toBe(false);

      // Every OTHER dimension's counts should reflect the audience=clinician
      // filter already applied: clinician modalities are act(1) cbt(2) ba(1)
      // mbct(1) = 5 total.
      const modalityCounts = Object.fromEntries(
        result.facets.modality.map((o) => [o.value, o.count]),
      );
      expect(modalityCounts).toEqual({ act: 1, cbt: 2, ba: 1, mbct: 1 });
    });

    it("computes unfiltered facet counts for the empty landing page, so browsing is discoverable", async () => {
      const result = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS);
      expect(result.mode).toBe("empty");
      expect(result.total).toBe(0);

      const access = Object.fromEntries(result.facets.access.map((o) => [o.value, o.count]));
      expect(access).toEqual({ free: 2, paywalled: 1 }); // 9 null-oa_status entries excluded

      const storage = Object.fromEntries(result.facets.storage.map((o) => [o.value, o.count]));
      expect(storage).toEqual({ stored: 7, link_only: 5 });

      const linkStatus = Object.fromEntries(
        result.facets.linkStatus.map((o) => [o.value, o.count]),
      );
      expect(linkStatus).toEqual({ ok: 9, blocked: 2, unchecked: 1 });

      const kind = Object.fromEntries(result.facets.kind.map((o) => [o.value, o.count]));
      expect(kind).toEqual({ literature: 3, materials: 9 });
    });

    it("ignores unknown/invalid facet values rather than erroring", async () => {
      const result = await searchEntries(
        env.DB,
        "",
        1,
        filters({ audience: ["not-a-real-audience" as FacetFilters["audience"][number]] }),
      );
      // An unrecognized value never reaches SQL from parseFacetFilters, but
      // searchEntries itself must also stay safe if a filter object is
      // constructed directly with a bogus value — worst case it's bound as a
      // literal that matches nothing, never throws.
      expect(result.mode).toBe("browse");
      expect(result.total).toBe(0);
    });
  });

  describe("Phase 2.5A corpus split", () => {
    function filters(overrides: Partial<FacetFilters>): FacetFilters {
      return { ...EMPTY_FACET_FILTERS, ...overrides };
    }

    it("browses literature as papers and materials as everything else, with no query", async () => {
      const literature = await searchEntries(env.DB, "", 1, filters({ kind: "literature" }));
      expect(literature.mode).toBe("browse");
      expect(literature.hits.map((h) => h.id)).toEqual([
        "bbbbbbbb00000003",
        "cccccccc00000006",
        "eeeeeeee00000009",
      ]);
      expect(literature.hits.every((h) => h.resource_type === "paper")).toBe(true);
      expect(literature.hits.every((h) => h.audience !== undefined)).toBe(true);

      const materials = await searchEntries(env.DB, "", 1, filters({ kind: "materials" }));
      expect(materials.mode).toBe("browse");
      expect(materials.total).toBe(9);
      expect(materials.hits.some((h) => h.resource_type === "paper")).toBe(false);
    });

    it("keeps a keyword search with kind=literature inside papers", async () => {
      const result = await searchEntries(env.DB, "depression", 1, filters({ kind: "literature" }));
      expect(result.mode).toBe("fts");
      expect(result.hits.map((h) => h.id).sort()).toEqual([
        "bbbbbbbb00000003",
        "cccccccc00000006",
      ]);
    });

    it("still returns the empty landing when nothing is selected", async () => {
      const result = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS);
      expect(result.mode).toBe("empty");
      expect(result.total).toBe(0);
    });
  });

  describe("Phase 2.5B unused dimensions as facets", () => {
    function filters(overrides: Partial<FacetFilters>): FacetFilters {
      return { ...EMPTY_FACET_FILTERS, ...overrides };
    }

    it("browses topic=depression with no query as the two tagged papers", async () => {
      const result = await searchEntries(env.DB, "", 1, filters({ topic: ["depression"] }));
      expect(result.mode).toBe("browse");
      expect(result.hits.map((h) => h.id).sort()).toEqual([
        "bbbbbbbb00000003",
        "cccccccc00000006",
      ]);
    });

    it("browses hexaflex=values as the values worksheet", async () => {
      const result = await searchEntries(env.DB, "", 1, filters({ hexaflex: ["values"] }));
      expect(result.mode).toBe("browse");
      expect(result.hits.map((h) => h.id)).toEqual(["aaaaaaaa00000001"]);
    });

    it("filters literature by decade buckets over published_date", async () => {
      const teens = await searchEntries(
        env.DB,
        "",
        1,
        filters({ kind: "literature", decade: ["2010s"] }),
      );
      expect(teens.hits.map((h) => h.id)).toEqual(["cccccccc00000006"]);

      const twenties = await searchEntries(
        env.DB,
        "",
        1,
        filters({ kind: "literature", decade: ["2020s"] }),
      );
      expect(twenties.hits.map((h) => h.id).sort()).toEqual([
        "bbbbbbbb00000003",
        "eeeeeeee00000009",
      ]);
    });

    it("filters materials by resource type and never returns papers", async () => {
      const result = await searchEntries(
        env.DB,
        "",
        1,
        filters({ kind: "materials", type: ["handout"] }),
      );
      expect(result.mode).toBe("browse");
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every((h) => h.resource_type === "handout")).toBe(true);
      expect(result.hits.some((h) => h.resource_type === "paper")).toBe(false);
    });
  });

  describe("Phase 2.5C directory landings", () => {
    it("returns unfiltered topic and hexaflex counts from getTagCounts", async () => {
      expect(await getTagCounts(env.DB, "topic")).toEqual([
        { name: "anxiety", count: 1 },
        { name: "depression", count: 2 },
        { name: "trauma", count: 1 },
      ]);
      expect(await getTagCounts(env.DB, "hexaflex")).toEqual([
        { name: "defusion", count: 1 },
        { name: "values", count: 1 },
      ]);
    });

    it("serves /psychotherapy/topics with search URLs and live counts", async () => {
      const ctx = createExecutionContext();
      const res = await app.request("/psychotherapy/topics", {}, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="/psychotherapy/search?topic=depression"');
      expect(html).toMatch(/topic=depression[\s\S]*?stat-count">2</);
      expect(html).not.toMatch(/href="\/psychotherapy\/search\?[^"]*kind=/);
      expect(html).toContain('href="/psychotherapy/topics"');
    });

    it("serves /psychotherapy/hexaflex with materials-biased search URLs", async () => {
      const ctx = createExecutionContext();
      const res = await app.request("/psychotherapy/hexaflex", {}, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(
        'href="/psychotherapy/search?kind=materials&amp;hexaflex=values"',
      );
      expect(html).toContain("client materials first");
    });
  });

  describe("Phase 2.5D neighbors search", () => {
    function filters(overrides: Partial<FacetFilters>): FacetFilters {
      return { ...EMPTY_FACET_FILTERS, ...overrides };
    }

    it("returns rank-ordered neighbors for like= with no query", async () => {
      const first = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS, {
        likeId: "aaaaaaaa00000001",
      });
      expect(first.mode).toBe("neighbors");
      expect(first.likeId).toBe("aaaaaaaa00000001");
      expect(first.hits.map((h) => h.id)).toEqual([
        "aaaaaaaa00000002",
        "bbbbbbbb00000003",
      ]);

      const second = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS, {
        likeId: "aaaaaaaa00000001",
      });
      expect(second.hits.map((h) => h.id)).toEqual(first.hits.map((h) => h.id));
    });

    it("intersects neighbors with kind=materials", async () => {
      const result = await searchEntries(env.DB, "", 1, filters({ kind: "materials" }), {
        likeId: "aaaaaaaa00000001",
      });
      expect(result.mode).toBe("neighbors");
      expect(result.hits.map((h) => h.id)).toEqual(["aaaaaaaa00000002"]);
      expect(result.hits.some((h) => h.resource_type === "paper")).toBe(false);
    });

    it("lets a keyword query win over like=", async () => {
      const result = await searchEntries(env.DB, "depression", 1, EMPTY_FACET_FILTERS, {
        likeId: "aaaaaaaa00000001",
      });
      expect(result.mode).not.toBe("neighbors");
      expect(result.likeId).toBeNull();
      expect(result.hits.map((h) => h.id).sort()).toEqual([
        "bbbbbbbb00000003",
        "cccccccc00000006",
      ]);
    });

    it("returns neighbors mode with zero hits for an unknown id", async () => {
      const result = await searchEntries(env.DB, "", 1, EMPTY_FACET_FILTERS, {
        likeId: "doesnotexist0000",
      });
      expect(result.mode).toBe("neighbors");
      expect(result.total).toBe(0);
      expect(result.hits).toEqual([]);
    });

    it("renders similar-to copy and a hidden like field on the search page", async () => {
      const ctx = createExecutionContext();
      const res = await app.request(
        "/psychotherapy/search?like=aaaaaaaa00000001",
        {},
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('name="like"');
      expect(html).toContain('value="aaaaaaaa00000001"');
      expect(html).toContain("similar to");
      expect(html).toContain("Defusion Techniques for Anxiety");
      expect(html).not.toContain("No similar entries for this item.");

      const emptyCtx = createExecutionContext();
      const emptyRes = await app.request(
        "/psychotherapy/search?like=doesnotexist0000",
        {},
        env,
        emptyCtx,
      );
      await waitOnExecutionContext(emptyCtx);
      expect(await emptyRes.text()).toContain("No similar entries for this item.");
    });
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
    expect(html).toContain('<span class="badge">client</span>');
    expect(html).toContain('href="/psychotherapy/search?hexaflex=values"');
    expect(html).toContain('href="/psychotherapy/search?like=aaaaaaaa00000001"');
    expect(html).toContain("More like this");
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

  it("renders related entries and all three citation formats on an entry page (Phase 2C)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/entries/bbbbbbbb00000003",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();

    expect(html).toContain("Related entries");
    expect(html).toContain("More like this");
    expect(html).toContain('href="/psychotherapy/search?like=bbbbbbbb00000003"');
    expect(html).toContain("Behavioral Activation for Depression");
    expect(html).toContain('<span class="badge">clinician</span>');
    expect(html).toContain("C. Researcher, D. Colleague");
    expect(html).toContain('href="/psychotherapy/search?topic=depression"');
    expect(html).toContain(">depression</a>");
    expect(html).not.toMatch(/href="\/psychotherapy\/search\?[^"]*modality=act"/);

    expect(html).toContain("Cite this entry");
    expect(html).toContain("@article{allodium:bbbbbbbb00000003,");
    expect(html).toContain("TY  - JOUR");
    expect(html).toContain("Researcher, C., &amp; Colleague, D.");
    expect(html).toContain('href="https://doi.org/10.1000/act.depression.meta"');
    expect(html).toContain('src="/app.js"');
  });

  it("shows an honest empty state for related entries when none are computed (Phase 2C)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/entries/dddddddd00000007",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain("No related entries in this snapshot");
    expect(html).not.toContain("More like this");
  });

  it('renders an "Add to shortlist" button on entry and search pages (Phase 2D)', async () => {
    const entryCtx = createExecutionContext();
    const entryRes = await app.request(
      "/psychotherapy/entries/aaaaaaaa00000001",
      {},
      env,
      entryCtx,
    );
    await waitOnExecutionContext(entryCtx);
    const entryHtml = await entryRes.text();
    expect(entryHtml).toContain('data-shortlist-id="aaaaaaaa00000001"');

    const searchCtx = createExecutionContext();
    const searchRes = await app.request(
      "/psychotherapy/search?q=trauma",
      {},
      env,
      searchCtx,
    );
    await waitOnExecutionContext(searchCtx);
    const searchHtml = await searchRes.text();
    expect(searchHtml).toContain('data-shortlist-id="cccccccc00000005"');
  });

  it("renders a persistent Shortlist nav link on psychotherapy pages (Phase 2D)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/psychotherapy", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain('href="/psychotherapy/list" id="shortlist-nav-link"');
  });

  it("renders a build-a-shortlist prompt when ids is absent (Phase 2D)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/psychotherapy/list", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No items yet");
  });

  it("renders shortlist entries, per-row remove links, and combined citation exports (Phase 2D)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/list?ids=aaaaaaaa00000001,bbbbbbbb00000003",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();

    expect(html).toContain("2 entries in this shortlist");
    expect(html).toContain("Values Clarification Worksheet");
    expect(html).toContain("Acceptance and Commitment Therapy for Depression");

    // Each row's "Remove from this shared list" link points at the URL with just
    // the *other* id left.
    expect(html).toContain("Remove from this shared list");
    expect(html).toContain('href="/psychotherapy/list?ids=bbbbbbbb00000003"');
    expect(html).toContain('href="/psychotherapy/list?ids=aaaaaaaa00000001"');

    expect(html).toContain("Cite these entries");
    expect(html).toContain("@misc{allodium:aaaaaaaa00000001,");
    expect(html).toContain("@article{allodium:bbbbbbbb00000003,");
    expect(html).toContain("TY  - GEN");
    expect(html).toContain("TY  - JOUR");
  });

  it("shows an honest note for unresolvable ids without failing the whole page (Phase 2D)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/list?ids=bbbbbbbb00000003,doesnotexist0000",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain("1 entry in this shortlist");
    expect(html).toContain("1 item in this link could not be shown");
  });

  it("shows a fully-missing state when every id in the link is unresolvable (Phase 2D)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/list?ids=doesnotexist0000",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).toContain("None of the items in this link could be found.");
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
    expect(html).toMatch(/type="checkbox"[^>]*data-auto-submit/);
    expect(html).not.toMatch(/type="radio"[^>]*data-auto-submit/);
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

  it("serves the home page as a collection directory", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("A place of free knowledge");
    expect(html).toContain('<span class="stat-value">12</span>');
    expect(html).toContain('<span class="stat-label">entries</span>');
    expect(html).toContain("live collection");
    expect(html).toContain("/standard");
    expect(html).toContain("Collections");
    expect(html).toContain('href="/psychotherapy"');
    expect(html).toContain("Physics");
    expect(html).toContain("Cosmology");
    expect(html).toContain("In progress");
    expect(html).toContain("collection-card-planned");
    expect(html).not.toContain("/psychotherapy/search?kind=literature");
    expect(html).not.toContain('id="shortlist-nav-link"');
    expect(html).not.toContain("Disclaimer &amp; crisis resources");
  });

  it("serves /psychotherapy with doors, coverage, and collection chrome", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/psychotherapy", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("A verified index of evidence");
    expect(html).toContain("/psychotherapy/search?kind=literature");
    expect(html).toContain("/psychotherapy/search?kind=materials");
    expect(html).toContain("3 papers");
    expect(html).toContain("9 resources");
    expect(html).toContain("Search everything");
    expect(html).toContain('href="/psychotherapy/topics"');
    expect(html).toContain('href="/psychotherapy/hexaflex"');
    expect(html).toContain(">Topics</a>");
    expect(html).toContain(">Hexaflex</a>");
    expect(html).toContain("Identity checks");
    expect(html).toContain("What&#39;s excluded, and why");
    expect(html).toContain('id="shortlist-nav-link"');
    expect(html).toContain("/psychotherapy/disclaimer");
  });

  it("maps collectionForPath onto live psychotherapy routes only", () => {
    expect(collectionForPath("/psychotherapy")?.slug).toBe("psychotherapy");
    expect(collectionForPath("/psychotherapy/search")?.slug).toBe("psychotherapy");
    expect(collectionForPath("/psychotherapy/disclaimer")?.slug).toBe(
      "psychotherapy",
    );
    expect(collectionForPath("/")).toBeNull();
    expect(collectionForPath("/standard")).toBeNull();
    expect(collectionForPath("/physics")).toBeNull();
  });

  it("serves /standard as cross-collection methodology without snapshot tables", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/standard", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("The Standard");
    expect(html).toContain("Optional AI-assisted search");
    expect(html).toContain("qwen2.5:7b-instruct-q6_k");
    expect(html).toContain("988");
    expect(html).toContain('href="/psychotherapy"');
    expect(html).not.toContain("What's excluded, and why");
    expect(html).not.toContain("gpu-runbook");
    expect(html).not.toMatch(/SYNTHETIC ABSTRACT/i);
    expect(html).not.toMatch(/file_path/i);
  });

  it("redirects /disclaimer to /psychotherapy/disclaimer", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/disclaimer", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/psychotherapy/disclaimer");
  });

  it("serves /psychotherapy/disclaimer with crisis routing", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/psychotherapy/disclaimer", {}, env, ctx);
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
      "/psychotherapy",
      "/psychotherapy/disclaimer",
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

  it("renders a canonical link matching SITE_URL on every page", async () => {
    const cases: Array<[string, string]> = [
      ["/", "/"],
      ["/standard", "/standard"],
      ["/psychotherapy", "/psychotherapy"],
      ["/psychotherapy/disclaimer", "/psychotherapy/disclaimer"],
      ["/psychotherapy/search", "/psychotherapy/search"],
      ["/psychotherapy/topics", "/psychotherapy/topics"],
      ["/psychotherapy/hexaflex", "/psychotherapy/hexaflex"],
      [
        "/psychotherapy/entries/aaaaaaaa00000001",
        "/psychotherapy/entries/aaaaaaaa00000001",
      ],
    ];
    for (const [path, canonicalPath] of cases) {
      const ctx = createExecutionContext();
      const res = await app.request(path, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      const html = await res.text();
      expect(html).toContain(
        `<link rel="canonical" href="${SITE_URL}${canonicalPath}"/>`,
      );
    }
  });

  it("omits a canonical link on the 404 page", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/does-not-exist", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).not.toContain('rel="canonical"');
  });

  it("embeds valid ScholarlyArticle JSON-LD on a paper entry page", async () => {
    const ctx = createExecutionContext();
    const res = await app.request(
      "/psychotherapy/entries/bbbbbbbb00000003",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    const match = html.match(
      /<script type="application\/ld\+json">([^<]*)<\/script>/,
    );
    expect(match).not.toBeNull();
    const jsonLd = JSON.parse(match![1]);
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("WebPage");
    expect(jsonLd.url).toBe(
      `${SITE_URL}/psychotherapy/entries/bbbbbbbb00000003`,
    );
    expect(jsonLd.mainEntity["@type"]).toBe("ScholarlyArticle");
    expect(jsonLd.mainEntity.identifier).toBe(
      "https://doi.org/10.1000/act.depression.meta",
    );
  });

  it("omits JSON-LD on non-entry pages", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const html = await res.text();
    expect(html).not.toContain("application/ld+json");
  });

  it("serves /sitemap.xml with static routes and every entry, cached for an hour", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/sitemap.xml", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const xml = await res.text();
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/psychotherapy</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/psychotherapy/search</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/psychotherapy/topics</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/psychotherapy/hexaflex</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/psychotherapy/disclaimer</loc>`);
    expect(xml).not.toContain(`<loc>${SITE_URL}/disclaimer</loc>`);
    expect(xml).toContain(
      `<loc>${SITE_URL}/psychotherapy/entries/aaaaaaaa00000001</loc>`,
    );
    const urlCount = (xml.match(/<url>/g) ?? []).length;
    expect(urlCount).toBe(12 + STATIC_SITEMAP_PATHS.length);
  });

  it("sets the shared security header set on HTML and JSON responses alike", async () => {
    const routes = ["/", "/standard", "/psychotherapy/search", "/health"];
    for (const path of routes) {
      const ctx = createExecutionContext();
      const res = await app.request(path, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers.get("Content-Security-Policy")).toContain(
        "default-src 'self'",
      );
      expect(res.headers.get("Content-Security-Policy")).toContain(
        "font-src 'self'",
      );
      expect(res.headers.get("Permissions-Policy")).toContain(
        "geolocation=()",
      );
    }
  });

  it("caches successful HTML GETs for 5 minutes but leaves sitemap's own cache header alone", async () => {
    const htmlCtx = createExecutionContext();
    const htmlRes = await app.request("/", {}, env, htmlCtx);
    await waitOnExecutionContext(htmlCtx);
    expect(htmlRes.headers.get("Cache-Control")).toBe("public, max-age=300");

    const sitemapCtx = createExecutionContext();
    const sitemapRes = await app.request("/sitemap.xml", {}, env, sitemapCtx);
    await waitOnExecutionContext(sitemapCtx);
    expect(sitemapRes.headers.get("Cache-Control")).toBe(
      "public, max-age=3600",
    );
  });

  it("applies the security header set to the 500 error page too", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      // Rename (not drop) so the table -- schema and rows both -- comes
      // back untouched afterwards; getManifest() throws on the missing
      // table, which is what actually exercises app.onError here.
      await env.DB.prepare(
        `ALTER TABLE snapshot_manifest RENAME TO snapshot_manifest_tmp`,
      ).run();
      const ctx = createExecutionContext();
      const res = await app.request("/", {}, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(500);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Security-Policy")).toContain(
        "default-src 'self'",
      );
    } finally {
      await env.DB.prepare(
        `ALTER TABLE snapshot_manifest_tmp RENAME TO snapshot_manifest`,
      ).run();
      console.error = original;
    }
  });
});
