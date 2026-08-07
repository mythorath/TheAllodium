import { describe, expect, it } from "vitest";
import { parse as parseBibtex } from "@retorquere/bibtex-parser";
import { read as readRis } from "@customcommander/ris";
import { buildApa, buildBibtex, buildCitations, buildRis } from "../src/citations";
import type { PublicEntry } from "../src/contract";

/**
 * Phase 2C. `src/citations.ts` is a pure function of `PublicEntry` — no D1,
 * no Workers runtime needed — so these are plain unit tests. Per the
 * roadmap's exit-gate criterion, BibTeX/RIS output is validated against
 * real third-party parsers (`@retorquere/bibtex-parser`, the engine behind
 * Better BibTeX for Zotero; `@customcommander/ris`), not just re-checked
 * against our own formatting logic.
 *
 * Note: `@retorquere/bibtex-parser` applies BibTeX's conventional sentence
 * casing to the `title` field (a display-time transform real bibliography
 * styles all apply), so title assertions below compare case-insensitively;
 * every other field is preserved verbatim by both parsers.
 */

function baseEntry(overrides: Partial<PublicEntry>): PublicEntry {
  return {
    id: "aaaaaaaa00000001",
    title: "Values Clarification Worksheet",
    resource_type: "worksheet",
    therapy_modality: "act",
    source_org: "Example Clinical Org",
    canonical_url: "https://example.org/act/values-worksheet",
    author: "A. Clinician",
    published_date: "2020-01-15",
    credibility_tier: 1,
    is_link_only: false,
    citation_count: null,
    oa_status: null,
    doi: null,
    pmid: null,
    pmcid: null,
    link_status: "ok",
    link_checked_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
    audience: "client",
    authors: null,
    tags: [],
    verifications: [],
    ...overrides,
  };
}

const paperWithStructuredAuthors = baseEntry({
  id: "bbbbbbbb00000003",
  title: "Acceptance and Commitment Therapy for Depression: A Meta-Analysis",
  resource_type: "paper",
  therapy_modality: "act",
  source_org: "Open Access Journal",
  canonical_url: "https://doi.org/10.1000/act.depression.meta",
  author: "C. Researcher and D. Colleague",
  published_date: "2021",
  doi: "10.1000/act.depression.meta",
  audience: "clinician",
  authors: [
    { name: "C. Researcher", orcid: null, institution: null, position: "first" },
    { name: "D. Colleague", orcid: null, institution: null, position: "last" },
  ],
});

const clientResourceWithPlainAuthor = baseEntry({});

const noAuthorNoDateEntry = baseEntry({
  id: "bbbbbbbb00000004",
  title: "Cognitive Restructuring Protocol",
  resource_type: "protocol",
  therapy_modality: "cbt",
  source_org: "CBT Resource Hub",
  canonical_url: "https://example.org/cbt/restructuring",
  author: null,
  published_date: null,
  audience: "clinician",
  authors: null,
});

describe("buildBibtex", () => {
  it("produces an @article with structured authors, doi, and a doi.org url, valid per a real BibTeX parser", () => {
    const bibtex = buildBibtex(paperWithStructuredAuthors);
    expect(bibtex).toContain("@article{allodium:bbbbbbbb00000003,");
    expect(bibtex).toContain("doi = {10.1000/act.depression.meta}");
    expect(bibtex).toContain("url = {https://doi.org/10.1000/act.depression.meta}");

    const parsed = parseBibtex(bibtex);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toHaveLength(1);
    const entry = parsed.entries[0];
    expect(entry.type).toBe("article");
    expect(entry.key).toBe("allodium:bbbbbbbb00000003");
    expect(entry.fields.title?.toLowerCase()).toBe(
      paperWithStructuredAuthors.title.toLowerCase(),
    );
    expect(entry.fields.author).toHaveLength(2);
    expect(entry.fields.year).toBe("2021");
    expect(entry.fields.journal).toBe("Open Access Journal");
    expect(entry.fields.doi).toBe("10.1000/act.depression.meta");
    expect(entry.fields.url).toBe("https://doi.org/10.1000/act.depression.meta");
  });

  it("produces an @misc for non-paper resources, falls back to the plain author string, and uses canonical_url with no doi", () => {
    const bibtex = buildBibtex(clientResourceWithPlainAuthor);
    expect(bibtex).toContain("@misc{allodium:aaaaaaaa00000001,");
    expect(bibtex).not.toContain("doi =");

    const parsed = parseBibtex(bibtex);
    expect(parsed.errors).toEqual([]);
    const entry = parsed.entries[0];
    expect(entry.type).toBe("misc");
    expect(entry.fields.author).toHaveLength(1);
    expect(entry.fields.url).toBe("https://example.org/act/values-worksheet");
  });

  it("omits author/year fields entirely rather than emitting empty ones, and still parses cleanly", () => {
    const bibtex = buildBibtex(noAuthorNoDateEntry);
    expect(bibtex).not.toContain("author =");
    expect(bibtex).not.toContain("year =");
    expect(bibtex).not.toContain("doi =");

    const parsed = parseBibtex(bibtex);
    expect(parsed.errors).toEqual([]);
    const entry = parsed.entries[0];
    expect(entry.type).toBe("misc");
    expect(entry.fields.organization).toEqual(["CBT Resource Hub"]);
    expect(entry.fields.url).toBe("https://example.org/cbt/restructuring");
  });

  it("escapes LaTeX special characters so a title survives a real parser round trip", () => {
    const entry = baseEntry({
      id: "cccccccc00000009",
      title: "R&D Notes: 50% Progress, #1 Priority & Beyond",
    });
    const bibtex = buildBibtex(entry);
    const parsed = parseBibtex(bibtex);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries[0].fields.title).toContain("&");
    expect(parsed.entries[0].fields.title).toContain("%");
    expect(parsed.entries[0].fields.title).toContain("#");
  });
});

describe("buildRis", () => {
  it("produces a JOUR record with repeated AU lines, valid per a real RIS parser", () => {
    const ris = buildRis(paperWithStructuredAuthors);
    expect(ris).toContain("TY  - JOUR");
    expect(ris).toContain("DO  - 10.1000/act.depression.meta");
    expect(ris).toContain("UR  - https://doi.org/10.1000/act.depression.meta");
    expect(ris.trim().endsWith("ER  -")).toBe(true);

    const [record] = readRis(ris);
    expect(record).toBeDefined();
    expect(record.TY).toEqual(["JOUR"]);
    expect(record.TI).toEqual([paperWithStructuredAuthors.title]);
    expect(record.AU).toHaveLength(2);
    expect(record.PY).toEqual(["2021"]);
    expect(record.PB).toEqual(["Open Access Journal"]);
    expect(record.DO).toEqual(["10.1000/act.depression.meta"]);
    expect(record.UR).toEqual(["https://doi.org/10.1000/act.depression.meta"]);
  });

  it("produces a GEN record for non-paper resources with a single AU line", () => {
    const ris = buildRis(clientResourceWithPlainAuthor);
    const [record] = readRis(ris);
    expect(record.TY).toEqual(["GEN"]);
    expect(record.AU).toHaveLength(1);
    expect(record.UR).toEqual(["https://example.org/act/values-worksheet"]);
  });

  it("omits AU/PY/DO tags entirely when there's no author, date, or doi", () => {
    const ris = buildRis(noAuthorNoDateEntry);
    const [record] = readRis(ris);
    expect(record.AU).toBeUndefined();
    expect(record.PY).toBeUndefined();
    expect(record.DO).toBeUndefined();
    expect(record.PB).toEqual(["CBT Resource Hub"]);
  });
});

describe("buildApa", () => {
  it("formats multiple structured authors with initials and a doi.org link", () => {
    const apa = buildApa(paperWithStructuredAuthors);
    expect(apa).toBe(
      "Researcher, C., & Colleague, D. (2021). " +
        "Acceptance and Commitment Therapy for Depression: A Meta-Analysis. " +
        "Open Access Journal. https://doi.org/10.1000/act.depression.meta",
    );
  });

  it("falls back to the raw author display string unmodified when no structured authors exist", () => {
    const apa = buildApa(clientResourceWithPlainAuthor);
    expect(apa).toBe(
      "A. Clinician (2020). Values Clarification Worksheet. " +
        "Example Clinical Org. https://example.org/act/values-worksheet",
    );
  });

  it("leads with the title and uses n.d. when there's no author or date", () => {
    const apa = buildApa(noAuthorNoDateEntry);
    expect(apa).toBe(
      "Cognitive Restructuring Protocol. (n.d.). " +
        "CBT Resource Hub. https://example.org/cbt/restructuring",
    );
  });
});

describe("buildCitations", () => {
  it("returns all three formats keyed by name", () => {
    const citations = buildCitations(paperWithStructuredAuthors);
    expect(Object.keys(citations).sort()).toEqual(["apa", "bibtex", "ris"]);
    expect(citations.bibtex).toContain("@article");
    expect(citations.ris).toContain("TY  - JOUR");
    expect(citations.apa).toContain("Researcher, C.");
  });
});
