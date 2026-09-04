import { describe, expect, it } from "vitest";
import { scoreCredibility } from "../src/credibility/score";
import {
  CREDIBILITY_POLICY_VERSION,
  type AuthorityLookup,
  type AuthorityLookups,
  type CredibilityWork,
} from "../src/credibility/types";

const completeWork: CredibilityWork = {
  title: "A normalized research work",
  authors: ["A. Researcher"],
  publishedDate: "2026-01-02",
  doi: "10.1000/example",
  canonicalUrl: "https://doi.org/10.1000/example",
  publisher: "Example University Press",
  affiliations: ["Example University"],
  oaStatus: "gold",
  license: "CC BY 4.0",
  version: "version-of-record",
};

function lookup(matched: boolean | null, evidence = "Authority lookup result."): AuthorityLookup {
  return {
    matched,
    evidence,
    source: "Test authority dataset",
    license: "CC0-1.0",
  };
}

const signalOrder = [
  "doi-registered",
  "doi-resolving",
  "doaj",
  "medline",
  "openalex-core",
  "known-publisher",
  "ror-affiliation",
  "retraction-watch-retraction",
  "retraction-watch-expression-of-concern",
  "retraction-watch-correction",
  "retraction-watch-reinstatement",
  "open-access",
  "license",
  "publication-version",
  "metadata-completeness",
];

describe("credibility policy v1", () => {
  it("treats missing and negative allow-list evidence as neutral, never as not credible", () => {
    const result = scoreCredibility(completeWork, {
      doaj: lookup(false, "Journal was not found in this snapshot."),
      medline: lookup(null),
    });

    for (const id of ["doaj", "medline", "openalex-core", "known-publisher", "ror-affiliation"]) {
      expect(result.signals.find((item) => item.id === id)?.polarity).toBe("neutral");
      expect(result.signals.find((item) => item.id === id)?.contribution).toBeUndefined();
    }
    expect(result.signals.find((item) => item.id === "doaj")?.evidence).toMatch(
      /not evidence of low credibility/,
    );
    expect(result.uncertainty).toContain("MEDLINE was not checked or was indeterminate.");
  });

  it("adds independently sourced positive authority signals", () => {
    const authorities: AuthorityLookups = {
      doiRegistered: lookup(true, "DOI registration found."),
      doiResolves: lookup(true, "DOI resolved."),
      doaj: lookup(true, "Journal listed."),
      medline: lookup(true, "Journal indexed."),
      openAlexCore: lookup(true, "Source is_core=true."),
      knownPublisher: lookup(true, "Publisher identifier matched allow-list."),
      rorAffiliation: lookup(true, "Affiliation matched ROR."),
    };
    const result = scoreCredibility(completeWork, authorities);

    expect(result.score).toBe(100);
    expect(result.band).toBe("strongly-supported");
    expect(result.signals.filter((item) => item.polarity === "positive")).toHaveLength(11);
  });

  it("keeps a retracted record while making the warning and penalty visible", () => {
    const result = scoreCredibility(completeWork, {
      retractionWatch: {
        retraction: lookup(true, "Retraction dated 2025-05-04."),
      },
    });
    const retraction = result.signals.find(
      (item) => item.id === "retraction-watch-retraction",
    );

    expect(retraction).toMatchObject({ polarity: "negative", contribution: -35 });
    expect(result.score).toBe(26);
    expect(result.band).toBe("serious-concern");
    expect(result.signals).toHaveLength(signalOrder.length);
  });

  it("scores an expression of concern separately from retraction", () => {
    const result = scoreCredibility(completeWork, {
      retractionWatch: {
        expressionOfConcern: lookup(true, "Expression of concern dated 2026-02-03."),
      },
    });

    expect(
      result.signals.find(
        (item) => item.id === "retraction-watch-expression-of-concern",
      ),
    ).toMatchObject({ polarity: "negative", contribution: -18 });
    expect(
      result.signals.find((item) => item.id === "retraction-watch-retraction")?.polarity,
    ).toBe("neutral");
  });

  it("shows reinstatement without concealing the historical retraction", () => {
    const result = scoreCredibility(completeWork, {
      retractionWatch: {
        retraction: lookup(true, "Retracted in 2025."),
        reinstatement: lookup(true, "Reinstated in 2026."),
      },
    });

    expect(
      result.signals.find((item) => item.id === "retraction-watch-retraction"),
    ).toMatchObject({ polarity: "negative", contribution: -35 });
    expect(
      result.signals.find((item) => item.id === "retraction-watch-reinstatement"),
    ).toMatchObject({ polarity: "positive", contribution: 30 });
    expect(result.score).toBe(56);
  });

  it("bounds scores at both policy limits", () => {
    const allPositive: AuthorityLookups = {
      doiRegistered: lookup(true),
      doiResolves: lookup(true),
      doaj: lookup(true),
      medline: lookup(true),
      openAlexCore: lookup(true),
      knownPublisher: lookup(true),
      rorAffiliation: lookup(true),
      retractionWatch: { reinstatement: lookup(true) },
    };
    const allAdverse: AuthorityLookups = {
      doiRegistered: lookup(false),
      doiResolves: lookup(false),
      retractionWatch: {
        retraction: lookup(true),
        expressionOfConcern: lookup(true),
        correction: lookup(true),
      },
    };

    expect(scoreCredibility(completeWork, allPositive).score).toBe(100);
    expect(
      scoreCredibility(
        { title: null, version: "preprint" },
        allAdverse,
      ).score,
    ).toBe(0);
  });

  it("expands the composite into every versioned, attributed signal", () => {
    const result = scoreCredibility(completeWork);
    const contributionTotal = result.signals.reduce(
      (sum, item) => sum + (item.contribution ?? 0),
      50,
    );

    expect(result.policyVersion).toBe(CREDIBILITY_POLICY_VERSION);
    expect(result.score).toBe(contributionTotal);
    expect(result.signals.map((item) => item.id)).toEqual(signalOrder);
    for (const item of result.signals) {
      expect(item.version).toBe(CREDIBILITY_POLICY_VERSION);
      expect(item.label).not.toBe("");
      expect(item.evidence).not.toBe("");
      expect(item.source).not.toBe("");
      expect(item.license).not.toBe("");
    }
  });

  it("returns byte-stable ordering and values for identical inputs", () => {
    const lookups: AuthorityLookups = {
      doiRegistered: lookup(true),
      doaj: lookup(false),
      retractionWatch: { correction: lookup(true) },
    };

    expect(JSON.stringify(scoreCredibility(completeWork, lookups))).toBe(
      JSON.stringify(scoreCredibility(completeWork, lookups)),
    );
    expect(scoreCredibility(completeWork, lookups).signals.map((item) => item.id)).toEqual(
      signalOrder,
    );
  });
});
