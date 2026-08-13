import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import fullSnapshotSql from "../fixtures/full_snapshot.sql?raw";
import ftsSql from "../migrations/0002_fts.sql?raw";
import { execStatements } from "./sql-test-utils";
import { getEntry, searchEntries } from "../src/db/repository";
import { EMPTY_FACET_FILTERS } from "../src/db/facets";
import type { FacetFilters } from "../src/db/facets";
import { sortOrderBy } from "../src/db/sort";
import type { SortOption } from "../src/db/sort";

/**
 * Guards against the class of bug where a rendered `<a href>` for an entry
 * silently points at the wrong resource -- either because the underlying row
 * data is wrong/duplicated, or because a paginated list's `ORDER BY` doesn't
 * fully determine row order, so which entry lands at a given list
 * position/page can drift between otherwise-identical requests. Runs
 * against the real 5,643-row corpus (like tests/full-snapshot.test.ts)
 * because the tie risk this suite exists to catch is a property of the real
 * data (duplicate titles), not something a small synthetic fixture exposes.
 */
async function loadFullSnapshot() {
  await execStatements(env.DB, fullSnapshotSql);
  await execStatements(env.DB, ftsSql);
}

const ALL_SORT_OPTIONS: SortOption[] = [
  "relevance",
  "date_desc",
  "date_asc",
  "title_asc",
  "citations_desc",
];

describe("link integrity: data invariants over the real corpus", () => {
  beforeAll(async () => {
    await loadFullSnapshot();
  }, 60_000);

  it("has no duplicate entry ids", async () => {
    const dupes = await env.DB.prepare(
      `SELECT id, COUNT(*) AS c FROM entries GROUP BY id HAVING c > 1`,
    ).all<{ id: string; c: number }>();
    expect(dupes.results).toEqual([]);
  });

  it("never lets an alias_id double as a canonical entry id", async () => {
    const collisions = await env.DB.prepare(
      `SELECT a.alias_id FROM entry_aliases a JOIN entries e ON e.id = a.alias_id`,
    ).all<{ alias_id: string }>();
    expect(collisions.results).toEqual([]);
  });

  it("never leaves an alias pointing at a canonical id that doesn't exist", async () => {
    const dangling = await env.DB.prepare(
      `SELECT a.alias_id FROM entry_aliases a
       LEFT JOIN entries e ON e.id = a.canonical_id
       WHERE e.id IS NULL`,
    ).all<{ alias_id: string }>();
    expect(dangling.results).toEqual([]);
  });

  it("never gives one entry two neighbors at the same rank", async () => {
    const dupRanks = await env.DB.prepare(
      `SELECT entry_id, rank, COUNT(*) AS c FROM entry_neighbors
       GROUP BY entry_id, rank HAVING c > 1`,
    ).all<{ entry_id: string; rank: number; c: number }>();
    expect(dupRanks.results).toEqual([]);
  });

  it("really does contain rows with identical titles but different ids/urls (tie risk is real, not hypothetical)", async () => {
    const tiedTitles = await env.DB.prepare(
      `SELECT title, COUNT(*) AS c FROM entries GROUP BY title HAVING c > 1`,
    ).all<{ title: string; c: number }>();
    expect(tiedTitles.results.length).toBeGreaterThan(0);

    const sample = tiedTitles.results[0]!;
    const rows = await env.DB.prepare(`SELECT id, canonical_url FROM entries WHERE title = ?`)
      .bind(sample.title)
      .all<{ id: string; canonical_url: string }>();
    expect(new Set(rows.results.map((r) => r.id)).size).toBe(sample.c);
  });
});

describe("link integrity: ORDER BY must fully determine row order for every sort", () => {
  it("appends a unique-column tiebreaker (entry id) for every SortOption, scored and unscored alike", () => {
    // A tiebreaker on anything less unique than the primary key (title,
    // date, citation count) leaves SQLite/D1 free to return tied rows in an
    // implementation-defined order -- which the corpus-invariant test above
    // proves is not hypothetical (37 duplicate titles / 79 rows in the real
    // snapshot as of this writing). Without a final `e.id` (or equivalent
    // unique-key) tiebreaker, which entry lands at a given list
    // position/page can silently differ between two otherwise identical
    // requests. This is the one structural property that guarantees stable
    // pagination and stable list links over time -- checking it directly
    // is more reliable than trying to reproduce nondeterministic tie
    // ordering within a single local SQLite connection, which is typically
    // stable run-to-run even though the SQL spec does not guarantee it.
    for (const sort of ALL_SORT_OPTIONS) {
      for (const hasScore of [true, false]) {
        const orderBy = sortOrderBy(sort, hasScore);
        expect(orderBy).toMatch(/\be\.id\b/);
      }
    }
  });
});

describe("link integrity: pagination never skips or duplicates a row across pages", () => {
  beforeAll(async () => {
    await loadFullSnapshot();
  }, 60_000);

  const MAX_PAGES_TO_WALK = 20;

  async function collectAllIds(
    query: string,
    filters: FacetFilters,
    sort: SortOption,
  ): Promise<{ ids: string[]; total: number; pagesWalked: number; totalPages: number }> {
    const first = await searchEntries(env.DB, query, 1, filters, { sort });
    const ids = [...first.hits.map((h) => h.id)];
    const totalPages = Math.max(1, Math.ceil(first.total / first.pageSize));
    const pagesToWalk = Math.min(totalPages, MAX_PAGES_TO_WALK);
    for (let page = 2; page <= pagesToWalk; page++) {
      const result = await searchEntries(env.DB, query, page, filters, { sort });
      ids.push(...result.hits.map((h) => h.id));
    }
    return { ids, total: first.total, pagesWalked: pagesToWalk, totalPages };
  }

  // Chosen against the real corpus's known modality sizes (erp=67, mbrp=70,
  // ibct=28, cpt=76) so every case walks a handful of pages, not hundreds --
  // small enough to run every page, large enough to exercise real
  // LIMIT/OFFSET pagination across a page boundary. The FTS case searches
  // for the modality's own name, which `export_allodium_snapshot.py`'s
  // fetch_search_documents() always puts first in `meta` -- so every row in
  // that modality is guaranteed to match, without depending on title/topic
  // wording that could change as the corpus is re-crawled.
  const CASES: Array<{ name: string; query: string; filters: Partial<FacetFilters>; sort: SortOption }> = [
    { name: "browse erp, title_asc", query: "", filters: { modality: ["erp"] }, sort: "title_asc" },
    { name: "browse mbrp, date_desc", query: "", filters: { modality: ["mbrp"] }, sort: "date_desc" },
    { name: "browse ibct, citations_desc", query: "", filters: { modality: ["ibct"] }, sort: "citations_desc" },
    { name: "fts 'cpt' within cpt modality, relevance", query: "cpt", filters: { modality: ["cpt"] }, sort: "relevance" },
    { name: "browse topic=depression, title_asc", query: "", filters: { topic: ["depression"] }, sort: "title_asc" },
  ];

  for (const { name, query, filters, sort } of CASES) {
    it(`walks every page of "${name}" with no duplicate or missing ids`, async () => {
      const fullFilters: FacetFilters = { ...EMPTY_FACET_FILTERS, ...filters };
      const { ids, total, pagesWalked, totalPages } = await collectAllIds(query, fullFilters, sort);
      expect(total).toBeGreaterThan(0);
      // Sanity check that this case is actually testing multi-page pagination.
      expect(totalPages).toBeGreaterThanOrEqual(2);

      if (pagesWalked === totalPages) {
        expect(ids.length).toBe(total);
      }
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});

describe("link integrity: whole-catalog self-consistency", () => {
  beforeAll(async () => {
    await loadFullSnapshot();
  }, 60_000);

  it("returns the exact requested id, title, and canonical_url for a large sample of entries", async () => {
    const sample = await env.DB.prepare(
      `SELECT id, canonical_url, title FROM entries ORDER BY id LIMIT 300`,
    ).all<{ id: string; canonical_url: string; title: string }>();
    expect(sample.results.length).toBe(300);

    for (const row of sample.results) {
      const entry = await getEntry(env.DB, row.id);
      expect(entry?.id).toBe(row.id);
      expect(entry?.canonical_url).toBe(row.canonical_url);
      expect(entry?.title).toBe(row.title);
    }
  });

  it("never returns another entry's data for a random pair of distinct ids (no cross-contamination)", async () => {
    const sample = await env.DB.prepare(
      `SELECT id, canonical_url FROM entries ORDER BY id LIMIT 2 OFFSET 1000`,
    ).all<{ id: string; canonical_url: string }>();
    const [a, b] = sample.results;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.id).not.toBe(b!.id);

    const [entryA, entryB] = await Promise.all([
      getEntry(env.DB, a!.id),
      getEntry(env.DB, b!.id),
    ]);
    expect(entryA?.canonical_url).toBe(a!.canonical_url);
    expect(entryB?.canonical_url).toBe(b!.canonical_url);
    expect(entryA?.canonical_url).not.toBe(entryB?.canonical_url);
  });

  it("renders every duplicate-titled entry's own page with the matching id and Open-source link", async () => {
    // The exact bug class this whole file exists to catch: two entries that
    // share a title (so a reader can't disambiguate by text alone) must
    // still each resolve, by id, to their own distinct source -- never each
    // other's.
    const tied = await env.DB.prepare(
      `SELECT e.id, e.canonical_url FROM entries e
       WHERE e.title IN (SELECT title FROM entries GROUP BY title HAVING COUNT(*) > 1)`,
    ).all<{ id: string; canonical_url: string }>();
    expect(tied.results.length).toBeGreaterThan(0);

    for (const row of tied.results) {
      const ctx = createExecutionContext();
      const res = await app.request(`/psychotherapy/entries/${row.id}`, {}, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<code>${row.id}</code>`);
      expect(html).toContain(`href="${row.canonical_url}"`);
    }
  });
});
