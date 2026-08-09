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
} from "../src/db/repository";
import { EMPTY_FACET_FILTERS, buildFacetWhere, parseFacetFilters } from "../src/db/facets";
import type { FacetFilters } from "../src/db/facets";
import fixtureSql from "../fixtures/spike_fixture.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";
import { SITE_URL } from "../src/site-config";

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
    expect(html).toContain("Behavioral Activation for Depression");

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

  it("renders a persistent Shortlist nav link on every page (Phase 2D)", async () => {
    const ctx = createExecutionContext();
    const res = await app.request("/", {}, env, ctx);
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

  it("renders a canonical link matching SITE_URL on every page", async () => {
    const cases: Array<[string, string]> = [
      ["/", "/"],
      ["/standard", "/standard"],
      ["/disclaimer", "/disclaimer"],
      ["/psychotherapy/search", "/psychotherapy/search"],
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
    expect(xml).toContain(`<loc>${SITE_URL}/psychotherapy/search</loc>`);
    expect(xml).toContain(
      `<loc>${SITE_URL}/psychotherapy/entries/aaaaaaaa00000001</loc>`,
    );
    const urlCount = (xml.match(/<url>/g) ?? []).length;
    expect(urlCount).toBe(12 + 4);
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
