import { describe, expect, it } from "vitest";
import {
  ALLOWED_ENTRY_FIELDS,
  AUDIENCE_VALUES,
  CONTRACT_VERSION,
  FORBIDDEN_FIELDS,
  assertNoForbiddenKeys,
  pickAllowedEntryFields,
} from "../src/contract";

describe("publication contract v1.1", () => {
  it("includes identifiers needed for JSON-LD and citations", () => {
    expect(ALLOWED_ENTRY_FIELDS).toContain("doi");
    expect(ALLOWED_ENTRY_FIELDS).toContain("pmid");
    expect(ALLOWED_ENTRY_FIELDS).toContain("pmcid");
    expect(ALLOWED_ENTRY_FIELDS).toContain("link_status");
  });

  it("bumped the contract version for Phase 2A's audience/authors/neighbors additions", () => {
    expect(CONTRACT_VERSION).toBe("1.1");
  });

  it("includes the Phase 2A audience and authors_json fields", () => {
    expect(ALLOWED_ENTRY_FIELDS).toContain("audience");
    expect(ALLOWED_ENTRY_FIELDS).toContain("authors_json");
  });

  it("defines exactly the three contract audience values", () => {
    expect(AUDIENCE_VALUES).toEqual(["client", "clinician", "unknown"]);
  });

  it("denies private and rationale fields", () => {
    for (const field of [
      "notes",
      "file_path",
      "extracted_text_path",
      "abstract_text",
      "rationale",
    ] as const) {
      expect(FORBIDDEN_FIELDS).toContain(field);
    }
  });

  it("throws when forbidden keys appear on a public record", () => {
    expect(() => assertNoForbiddenKeys({ id: "x", notes: "secret" })).toThrow(
      /notes/,
    );
  });

  it("picks only allowlisted entry fields", () => {
    const picked = pickAllowedEntryFields({
      id: "aaaaaaaa00000001",
      title: "Values Clarification Worksheet",
      resource_type: "worksheet",
      therapy_modality: "act",
      source_org: "Example",
      canonical_url: "https://example.org/x",
      author: "A",
      published_date: "2020",
      credibility_tier: 1,
      is_link_only: 0,
      citation_count: null,
      oa_status: null,
      doi: null,
      pmid: null,
      pmcid: null,
      link_status: "ok",
      link_checked_at: null,
      updated_at: null,
      audience: "client",
      authors_json: null,
      notes: "must not survive",
      file_path: "/tank/secret.pdf",
      abstract_text: "must not survive",
    });
    expect(picked).not.toHaveProperty("notes");
    expect(picked).not.toHaveProperty("file_path");
    expect(picked).not.toHaveProperty("abstract_text");
    expect(picked.id).toBe("aaaaaaaa00000001");
    expect(picked.audience).toBe("client");
  });
});
