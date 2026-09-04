import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  decodeBrowseCursor,
  encodeBrowseCursor,
  getAuthorityHealth,
  getDomains,
  getRetractionsByDoi,
  getTopic,
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
});
