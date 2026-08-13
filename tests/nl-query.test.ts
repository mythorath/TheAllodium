import { describe, expect, it } from "vitest";
import { EMPTY_FACET_FILTERS } from "../src/db/facets";
import { normalizeNlFacets } from "../src/nl-query";
import type { NlAllowlists } from "../src/db/repository";

const allowlists: NlAllowlists = {
  modality: new Set(["act", "cbt"]),
  type: new Set(["worksheet", "paper"]),
  topic: new Set(["depression", "trauma"]),
  hexaflex: new Set(["values", "defusion"]),
};

describe("normalizeNlFacets (Phase 3B)", () => {
  it("maps mixed-case tokens onto canonical D1 values", () => {
    const result = normalizeNlFacets(
      {
        kind: "Literature",
        modality: ["ACT"],
        topic: ["Depression"],
        q: "worksheets",
      },
      allowlists,
    );
    expect(result).toEqual({
      filters: {
        ...EMPTY_FACET_FILTERS,
        kind: "literature",
        modality: ["act"],
        topic: ["depression"],
      },
      q: "worksheets",
    });
  });

  it("drops hallucinated values", () => {
    const result = normalizeNlFacets(
      {
        modality: ["research papers", "cbt"],
        topic: ["not-a-real-tag"],
        type: ["worksheet"],
      },
      allowlists,
    );
    expect(result?.filters.modality).toEqual(["cbt"]);
    expect(result?.filters.topic).toEqual([]);
    expect(result?.filters.type).toEqual(["worksheet"]);
  });

  it("returns null for junk or empty suggestions", () => {
    expect(normalizeNlFacets(null, allowlists)).toBeNull();
    expect(normalizeNlFacets("nope", allowlists)).toBeNull();
    expect(normalizeNlFacets({}, allowlists)).toBeNull();
    expect(normalizeNlFacets({ modality: ["nope"] }, allowlists)).toBeNull();
  });
});
