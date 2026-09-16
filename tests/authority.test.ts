import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  decodeBrowseCursor,
  encodeBrowseCursor,
  getAuthorityHealth,
  getDomains,
  getFederatedOverview,
  getHubWorks,
  getRelatedKeywords,
  getRelatedReasons,
  getRelatedSubjects,
  getRetractionsByDoi,
  getSiblingDomains,
  getSiblingFields,
  getSiblingSubfields,
  getSubfieldKeywords,
  getTopic,
  getVenuesByPublisher,
  hasAuthorityFamily,
  listTopicsForKeyword,
  listVenues,
  normalizeDoi,
  normalizeIssn,
} from "../src/authority/repository";

type FakeResult = Record<string, unknown>;

function fakeDb(options: {
  rows?: FakeResult[];
  first?: FakeResult | null;
  onBind?: (values: unknown[]) => void;
}): D1Database {
  return {
    prepare: () => {
      let bound: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => {
          bound = values;
          options.onBind?.(bound);
          return statement;
        },
        all: async () => ({ results: options.rows ?? [] }),
        first: async () => options.first ?? null,
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe("authority normalization", () => {
  it("normalizes DOI resolver URLs and labels", () => {
    expect(normalizeDoi(" HTTPS://doi.org/10.1000/ABC.9 ")).toBe("10.1000/abc.9");
    expect(normalizeDoi("doi: 10.5555/X")).toBe("10.5555/x");
  });

  it("normalizes common ISSN forms without inventing an ISSN-L", () => {
    expect(normalizeIssn("1234 567x")).toBe("1234-567X");
    expect(normalizeIssn("1234-5678")).toBe("1234-5678");
    expect(normalizeIssn("123")).toBe("123");
  });
});

describe("authority repository", () => {
  it("queries both notice and original-paper DOI with normalized values", async () => {
    let bindings: unknown[] = [];
    const db = fakeDb({
      onBind: (values) => {
        bindings = values;
      },
      rows: [
        {
          id: "rw-1",
          doi: "10.1/notice",
          original_paper_doi: "10.1/paper",
          title: "Retraction",
          journal: "Example Journal",
          publisher: null,
          notice_type: "Retraction",
          notice_date: "2026-01-01",
          reason_json: '["Error","Results unreliable"]',
        },
      ],
    });

    const notices = await getRetractionsByDoi(db, "https://doi.org/10.1/PAPER");

    expect(bindings).toEqual(["10.1/paper", "10.1/paper"]);
    expect(notices).toEqual([
      {
        id: "rw-1",
        doi: "10.1/notice",
        originalPaperDoi: "10.1/paper",
        title: "Retraction",
        journal: "Example Journal",
        publisher: null,
        noticeType: "Retraction",
        noticeDate: "2026-01-01",
        reasons: ["Error", "Results unreliable"],
      },
    ]);
  });

  it("treats a family with no manifest row as not loaded", async () => {
    let bindings: unknown[] = [];
    const db = fakeDb({
      first: null,
      onBind: (values) => {
        bindings = values;
      },
    });

    expect(await hasAuthorityFamily(db, "retraction_watch")).toBe(false);
    expect(bindings).toEqual(["retraction_watch"]);
  });

  it("treats a family with a populated manifest row as loaded", async () => {
    const db = fakeDb({ first: { present: 1 } });

    expect(await hasAuthorityFamily(db, "doaj")).toBe(true);
  });

  it("reports missing, stale, and malformed provenance timestamps", async () => {
    const common = {
      snapshot_id: "snapshot-1",
      schema_version: 1,
      source_name: "Source",
      source_url: "https://example.test/data",
      license_name: "CC0 1.0",
      license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
      source_checksum_sha256: "a".repeat(64),
      row_count: 1,
      metadata_json: "{}",
      imported_at: "2026-09-01T00:00:00Z",
    };
    const db = fakeDb({
      rows: [
        { ...common, family: "openalex", fetched_at: "2026-08-01T00:00:00Z" },
        { ...common, family: "ror", fetched_at: "2025-01-01T00:00:00Z" },
        { ...common, family: "retraction_watch", fetched_at: "not-a-date" },
        { ...common, family: "doaj", fetched_at: "2026-08-15T00:00:00Z" },
      ],
    });

    const health = await getAuthorityHealth(db, new Date("2026-09-01T00:00:00Z"), 90);

    expect(health.healthy).toBe(false);
    expect(health.missingFamilies).toEqual(["nlm"]);
    expect(health.staleFamilies).toEqual(["ror", "retraction_watch"]);
  });
});

describe("authority browse queries", () => {
  it("encodes and decodes composite browse cursors", () => {
    const encoded = encodeBrowseCursor("Example Journal", "S1");
    expect(decodeBrowseCursor(encoded)).toEqual({ name: "Example Journal", id: "S1" });
    expect(decodeBrowseCursor("therapy")).toEqual({ name: "therapy", id: "therapy" });
    expect(decodeBrowseCursor(null)).toBeNull();
  });

  it("loads scoped taxonomy without nested fields on the domain list", async () => {
    expect(env.AUTHORITY).toBeDefined();
    const db = env.AUTHORITY!;
    const domains = await getDomains(db);
    expect(domains.map((domain) => domain.displayName)).toEqual([
      "Health Sciences",
      "Social Sciences",
    ]);
    expect(domains[0]?.fields).toEqual([]);

    const topic = await getTopic(db, "D1", "FL1", "SF1", "T1");
    expect(topic?.topic.displayName).toBe("Cognitive Behavioral Therapy");
    expect(topic?.siblings).toEqual([]);
  });

  it("pages venues by keyset and lists topics that share a keyword", async () => {
    const db = env.AUTHORITY!;
    const first = await listVenues(db, { pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextAfter).toBeTruthy();
    const second = await listVenues(db, { after: first.nextAfter, pageSize: 1 });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    const topics = await listTopicsForKeyword(db, "therapy");
    expect(topics.map((topic) => topic.id).sort()).toEqual(["T1", "T2"]);
  });

    it("looks up a federated overview by normalized DOI and returns null when missing", async () => {
    const db = env.AUTHORITY!;
    const doi = "10.1000/example";
    await db.prepare("DELETE FROM federated_work_overviews WHERE doi = ?").bind(doi).run();
    expect(await getFederatedOverview(db, doi)).toBeNull();

    await db
      .prepare(
        `INSERT INTO federated_work_overviews (doi, overview, model, generated_at, source_note)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        doi,
        "A short generated paraphrase of the example paper.",
        "qwen3.6:35b",
        "2026-09-03T00:00:00Z",
        "test",
      )
      .run();

    try {
      expect(await getFederatedOverview(db, "https://doi.org/10.1000/EXAMPLE")).toBe(
        "A short generated paraphrase of the example paper.",
      );
      expect(await getFederatedOverview(db, "10.1000/missing")).toBeNull();
    } finally {
      await db.prepare("DELETE FROM federated_work_overviews WHERE doi = ?").bind(doi).run();
    }
  });
});

describe("authority hub rails", () => {
  it("joins hub works to retraction notices by DOI and splits cited from recent", async () => {
    let bindings: unknown[] = [];
    const db = fakeDb({
      onBind: (values) => {
        bindings = values;
      },
      rows: [
        {
          doi: "10.1000/example",
          title: "Retracted example paper",
          authors_json: '[{"name":"Ada Example","orcid":null}]',
          publication_year: 2020,
          publication_date: "2020-06-01",
          container_title: "Example Journal",
          work_type: "article",
          is_open_access: 1,
          cited_by_count: 42,
          canonical_url: "https://doi.org/10.1000/example",
          openalex_id: "https://openalex.org/W1",
          fetched_at: "2026-09-01T00:00:00Z",
          rank: 1,
          rank_kind: "cited",
          retracted: 1,
        },
        {
          doi: "10.1000/recent-ok",
          title: "Recent clinical paper",
          authors_json: '[{"name":"Cara Recent","orcid":null}]',
          publication_year: 2026,
          publication_date: "2026-08-01",
          container_title: "Example Journal",
          work_type: "article",
          is_open_access: 0,
          cited_by_count: 3,
          canonical_url: "https://doi.org/10.1000/recent-ok",
          openalex_id: "https://openalex.org/W3",
          fetched_at: "2026-09-01T00:00:00Z",
          rank: 1,
          rank_kind: "recent",
          retracted: 0,
        },
      ],
    });

    const works = await getHubWorks(db, "subfield", "SF1");

    expect(bindings).toEqual(["subfield", "SF1"]);
    expect(works.cited).toEqual([
      {
        doi: "10.1000/example",
        title: "Retracted example paper",
        authors: [{ name: "Ada Example", orcid: null }],
        publicationYear: 2020,
        publicationDate: "2020-06-01",
        containerTitle: "Example Journal",
        workType: "article",
        isOpenAccess: true,
        citedByCount: 42,
        canonicalUrl: "https://doi.org/10.1000/example",
        openalexId: "https://openalex.org/W1",
        fetchedAt: "2026-09-01T00:00:00Z",
        rank: 1,
        rankKind: "cited",
        retracted: true,
      },
    ]);
    expect(works.recent[0]?.doi).toBe("10.1000/recent-ok");
    expect(works.recent[0]?.retracted).toBe(false);
  });

  it("binds sibling taxonomy exclusions", async () => {
    let bindings: unknown[] = [];
    const db = fakeDb({
      onBind: (values) => {
        bindings = values;
      },
      rows: [
        {
          id: "D2",
          display_name: "Social Sciences",
          description: null,
          works_count: 3,
          cited_by_count: 4,
        },
      ],
    });

    expect((await getSiblingDomains(db, "D1"))[0]?.id).toBe("D2");
    expect(bindings).toEqual(["D1"]);
    await getSiblingFields(db, "D1", "FL1");
    expect(bindings).toEqual(["D1", "FL1"]);
    await getSiblingSubfields(db, "FL1", "SF1");
    expect(bindings).toEqual(["FL1", "SF1"]);
  });

  it("binds LIMIT on every co-occurrence rail query", async () => {
    let bindings: unknown[] = [];
    const db = fakeDb({
      onBind: (values) => {
        bindings = values;
      },
      rows: [{ name: "cognition", count: 2 }],
    });

    expect(await getSubfieldKeywords(db, "SF1", 1)).toEqual([{ name: "cognition", count: 2 }]);
    expect(bindings).toEqual(["SF1", 1]);

    await getRelatedKeywords(db, "therapy", 3);
    expect(bindings).toEqual(["therapy", 3]);

    await getRelatedSubjects(db, "Medicine", 4);
    expect(bindings).toEqual(["Medicine", 4]);

    await getRelatedReasons(db, "Error", 5);
    expect(bindings).toEqual(["Error", 5]);

    await getVenuesByPublisher(db, "P1", 2);
    expect(bindings).toEqual(["P1", 2]);
  });

  it("maps publisher venue rails from fake rows and keeps LIMIT last", async () => {
    let bindings: unknown[] = [];
    const db = fakeDb({
      onBind: (values) => {
        bindings = values;
      },
      rows: [
        {
          id: "S1",
          display_name: "Example Journal",
          source_type: "journal",
          works_count: 250,
        },
      ],
    });

    expect(await getVenuesByPublisher(db, "P1", 6)).toEqual([
      {
        id: "S1",
        displayName: "Example Journal",
        sourceType: "journal",
        worksCount: 250,
      },
    ]);
    expect(bindings).toEqual(["P1", 6]);
  });

  it("reads fixture hub works including the retracted DOI", async () => {
    const db = env.AUTHORITY!;
    const works = await getHubWorks(db, "subfield", "SF1");
    expect(works.cited.map((work) => work.doi)).toEqual([
      "10.1000/example",
      "10.1000/cited-ok",
    ]);
    expect(works.cited[0]?.retracted).toBe(true);
    expect(works.cited[1]?.retracted).toBe(false);
    expect(works.recent.map((work) => work.doi)).toEqual(["10.1000/recent-ok"]);

    const keywords = await getRelatedKeywords(db, "therapy", 1);
    expect(keywords).toHaveLength(1);
    const subjects = await getRelatedSubjects(db, "Medicine", 1);
    expect(subjects).toEqual([{ name: "Psychology", count: 1 }]);
    const venues = await getVenuesByPublisher(db, "P1", 1);
    expect(venues.map((venue) => venue.id)).toEqual(["S1"]);
  });
});
