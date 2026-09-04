import { describe, expect, it } from "vitest";
import {
  searchArxiv,
  searchCrossref,
  searchDblp,
  searchDoaj,
  searchDoab,
  searchEuropePmc,
  searchHal,
  searchZenodo,
} from "../src/federation/adapters";
import {
  arxivSyntheticDoi,
  dedupeAndMergeWorks,
  fallbackIdentityKey,
  normalizeDoi,
} from "../src/federation/identity";
import type {
  FederationSource,
  NormalizedWork,
} from "../src/federation/types";

function work(
  source: FederationSource,
  overrides: Partial<NormalizedWork> = {},
): NormalizedWork {
  return {
    title: "Acceptance and Commitment Therapy: A Review",
    authors: [
      {
        name: "Steven C. Hayes",
        familyName: "Hayes",
        givenName: "Steven C.",
        orcid: null,
      },
    ],
    publicationYear: 2006,
    publishedDate: "2006",
    doi: null,
    arxivId: null,
    pmid: null,
    pmcid: null,
    type: "journal-article",
    containerTitle: null,
    publisher: null,
    canonicalUrl: null,
    isOpenAccess: null,
    evidence: [
      {
        source,
        sourceId: `${source}-1`,
        recordUrl: null,
        retrievedAt: "2026-09-03T00:00:00.000Z",
        fields: ["title"],
        rank: 0,
        license: null,
      },
    ],
    ...overrides,
  };
}

describe("federation identity", () => {
  it("normalizes resolver URLs, prefixes, case, and trailing citation punctuation", () => {
    expect(normalizeDoi(" https://doi.org/10.1000/ABC.123). ")).toBe(
      "10.1000/abc.123",
    );
    expect(normalizeDoi("doi:10.5555/Example")).toBe("10.5555/example");
    expect(normalizeDoi("not a doi")).toBeNull();
  });

  it("builds version-independent arXiv synthetic DOIs", () => {
    expect(arxivSyntheticDoi("arXiv:2401.01234v3")).toBe(
      "10.48550/arxiv.2401.01234",
    );
    expect(arxivSyntheticDoi("hep-th/9901001")).toBe(
      "10.48550/arxiv.hep-th/9901001",
    );
  });

  it("normalizes fallback title, surname, and year identity", () => {
    expect(
      fallbackIdentityKey(
        "  Thé Effects—of ACT! ",
        "Hayes, Steven C.",
        "Published 2006",
      ),
    ).toBe("fallback:the effects of act|hayes|2006");
  });

  it("deduplicates by DOI and merges deterministically by source precedence", () => {
    const crossref = work("crossref", {
      doi: "https://doi.org/10.1000/TEST",
      publisher: "Crossref Publisher",
    });
    const pubmed = work("pubmed", {
      doi: "10.1000/test",
      pmid: "12345",
      title: "Preferred PubMed Title",
    });

    const forward = dedupeAndMergeWorks([crossref, pubmed]);
    const reverse = dedupeAndMergeWorks([pubmed, crossref]);
    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({
      doi: "10.1000/test",
      pmid: "12345",
      title: "Preferred PubMed Title",
      publisher: "Crossref Publisher",
    });
    expect(forward[0].evidence.map((item) => item.source)).toEqual([
      "pubmed",
      "crossref",
    ]);
  });

  it("deduplicates a DOI-less source through fallback identity", () => {
    const merged = dedupeAndMergeWorks([
      work("crossref", { doi: "10.1000/example" }),
      work("doaj", { canonicalUrl: "https://example.org/article" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].evidence).toHaveLength(2);
  });
});

describe("federation adapters", () => {
  it("normalizes Crossref results without exposing abstracts", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          message: {
            items: [
              {
                DOI: "10.1000/EXAMPLE",
                title: ["A Study"],
                author: [{ given: "Ada", family: "Lovelace" }],
                published: { "date-parts": [[2024, 2, 3]] },
                abstract: "Must not be redistributed",
                URL: "https://doi.org/10.1000/EXAMPLE",
                type: "journal-article",
              },
            ],
            "next-cursor": "next",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await searchCrossref(
      { text: "acceptance therapy", pageSize: 5 },
      { fetch: fetcher, now: () => new Date("2026-09-03T00:00:00Z") },
    );
    expect(result.status.kind).toBe("ok");
    expect(result.hits[0]).toMatchObject({
      title: "A Study",
      doi: "10.1000/example",
      publicationYear: 2024,
      publishedDate: "2024-02-03",
    });
    expect(result.hits[0]).not.toHaveProperty("abstract");
    expect(JSON.stringify(result.hits[0])).not.toContain("Must not");
  });

  it("returns structured network failures and never rejects", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("connection refused");
    };
    const result = await searchEuropePmc(
      { text: "benign query" },
      { fetch: fetcher },
    );
    expect(result.status).toMatchObject({
      kind: "network-error",
      message: "connection refused",
    });
    expect(result.hits).toEqual([]);
  });

  it("enforces a hard timeout even when injected fetch ignores abort", async () => {
    const fetcher: typeof fetch = () => new Promise<Response>(() => undefined);
    const result = await searchDoaj(
      { text: "benign query" },
      { fetch: fetcher, timeoutMs: 5 },
    );
    expect(result.status.kind).toBe("timeout");
    expect(result.hits).toEqual([]);
  });

  it("returns HTTP failures with retry information", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "12" },
      });
    const result = await searchCrossref(
      { text: "benign query" },
      { fetch: fetcher },
    );
    expect(result.status).toMatchObject({
      kind: "http-error",
      httpStatus: 429,
      retryAfterSeconds: 12,
    });
  });

  it("rejects invalid queries as data without calling fetch", async () => {
    let called = false;
    const fetcher: typeof fetch = async () => {
      called = true;
      return new Response("{}");
    };
    const result = await searchCrossref({ text: " " }, { fetch: fetcher });
    expect(result.status.kind).toBe("invalid-query");
    expect(called).toBe(false);
  });

  it("normalizes Zenodo's Invenio record shape", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          hits: {
            total: { value: 1 },
            hits: [
              {
                id: 123,
                pids: { doi: { identifier: "10.5281/ZENODO.123" } },
                links: { self_html: "https://zenodo.org/records/123" },
                access: { status: "open" },
                metadata: {
                  title: "Open Research Record",
                  publication_date: "2025-04-02",
                  publisher: "Zenodo",
                  creators: [
                    {
                      person_or_org: {
                        name: "Lovelace, Ada",
                        family_name: "Lovelace",
                        given_name: "Ada",
                        identifiers: [
                          { scheme: "orcid", identifier: "0000-0001-2345-6789" },
                        ],
                      },
                    },
                  ],
                  resource_type: { type: "publication-article" },
                  rights: [{ id: "cc-by-4.0" }],
                  description: "Must not be redistributed",
                },
              },
            ],
          },
          links: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await searchZenodo({ text: "open research" }, { fetch: fetcher });
    expect(result.hits[0]).toMatchObject({
      title: "Open Research Record",
      publicationYear: 2025,
      doi: "10.5281/zenodo.123",
      isOpenAccess: true,
    });
    expect(result.hits[0].authors[0]).toMatchObject({
      familyName: "Lovelace",
      orcid: "0000-0001-2345-6789",
    });
    expect(JSON.stringify(result.hits[0])).not.toContain("Must not");
  });

  it("normalizes HAL's allowlisted Solr fields", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          response: {
            numFound: 2,
            start: 0,
            docs: [
              {
                halId_s: "hal-01234567",
                title_s: ["Psychological Flexibility"],
                authFullName_s: ["Ada Lovelace"],
                authLastName_s: ["Lovelace"],
                authFirstName_s: ["Ada"],
                publicationDate_s: "2024-03-01",
                doiId_s: "10.1000/HAL",
                docType_s: "ART",
                journalTitle_s: "Example Journal",
                uri_s: "https://hal.science/hal-01234567",
                openAccess_bool: true,
              },
            ],
          },
        }),
        { status: 200 },
      );
    const result = await searchHal({ text: "flexibility", pageSize: 1 }, { fetch: fetcher });
    expect(result.hits[0]).toMatchObject({
      title: "Psychological Flexibility",
      doi: "10.1000/hal",
      publicationYear: 2024,
      isOpenAccess: true,
    });
    expect(result.nextCursor).toBe("1");
  });

  it("normalizes arXiv Atom and drops summaries", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom"
              xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
              xmlns:arxiv="http://arxiv.org/schemas/atom">
          <opensearch:totalResults>1</opensearch:totalResults>
          <entry>
            <id>http://arxiv.org/abs/2401.01234v2</id>
            <published>2024-01-03T00:00:00Z</published>
            <title>Safe &amp; Open Research</title>
            <summary>Must not be redistributed</summary>
            <author><name>Ada Lovelace</name></author>
            <arxiv:doi>10.1000/ARXIV</arxiv:doi>
            <category term="cs.DL"/>
            <link href="https://arxiv.org/abs/2401.01234v2" rel="alternate"/>
          </entry>
        </feed>`,
        { status: 200, headers: { "content-type": "application/atom+xml" } },
      );
    const result = await searchArxiv({ text: "open research" }, { fetch: fetcher });
    expect(result.hits[0]).toMatchObject({
      title: "Safe & Open Research",
      publicationYear: 2024,
      doi: "10.1000/arxiv",
      arxivId: "2401.01234",
      type: "cs.DL",
      isOpenAccess: true,
    });
    expect(JSON.stringify(result.hits[0])).not.toContain("Must not");
  });

  it("normalizes DOAB DSpace metadata", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          {
            uuid: "doab-1",
            name: "Fallback title",
            handle: "20.500.12854/123",
            type: "item",
            metadata: [
              { key: "dc.title", value: "Open Access Book" },
              { key: "dc.contributor.author", value: "Lovelace, Ada" },
              { key: "dc.date.issued", value: "2022" },
              { key: "dc.identifier.doi", value: "10.1000/DOAB" },
              { key: "dc.publisher", value: "Example Press" },
              { key: "dc.type", value: "book" },
              { key: "dc.rights.uri", value: "https://creativecommons.org/licenses/by/4.0/" },
              { key: "dc.description.abstract", value: "Must not be redistributed" },
            ],
          },
        ]),
        { status: 200 },
      );
    const result = await searchDoab({ text: "open access book" }, { fetch: fetcher });
    expect(result.hits[0]).toMatchObject({
      title: "Open Access Book",
      publicationYear: 2022,
      doi: "10.1000/doab",
      publisher: "Example Press",
      type: "book",
      isOpenAccess: true,
    });
    expect(JSON.stringify(result.hits[0])).not.toContain("Must not");
  });

  it("normalizes DBLP publication search JSON", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          result: {
            hits: {
              "@total": "2",
              "@first": "0",
              hit: [
                {
                  info: {
                    authors: {
                      author: [{ "@pid": "1", text: "Ada Lovelace" }],
                    },
                    title: "A Bibliographic Study",
                    venue: "ExampleConf",
                    year: "2023",
                    type: "Conference and Workshop Papers",
                    access: "open",
                    key: "conf/example/Lovelace23",
                    doi: "10.1000/DBLP",
                    url: "https://dblp.org/rec/conf/example/Lovelace23",
                  },
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    const result = await searchDblp({ text: "bibliographic", pageSize: 1 }, { fetch: fetcher });
    expect(result.hits[0]).toMatchObject({
      title: "A Bibliographic Study",
      publicationYear: 2023,
      doi: "10.1000/dblp",
      containerTitle: "ExampleConf",
      isOpenAccess: true,
    });
    expect(result.hits[0].authors[0].name).toBe("Ada Lovelace");
    expect(result.nextCursor).toBe("1");
  });

  it("keeps every added adapter fail-open on transport errors", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("offline");
    };
    const adapters = [
      searchZenodo,
      searchHal,
      searchArxiv,
      searchDoab,
      searchDblp,
    ] as const;
    const results = await Promise.all(
      adapters.map((adapter) => adapter({ text: "benign query" }, { fetch: fetcher })),
    );
    expect(results.map((result) => result.status.kind)).toEqual([
      "network-error",
      "network-error",
      "network-error",
      "network-error",
      "network-error",
    ]);
    expect(results.every((result) => result.hits.length === 0)).toBe(true);
  });
});
