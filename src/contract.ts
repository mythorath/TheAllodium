/** Publication contract v1.1 — allowlist and denylist for public D1 rows. */

export const CONTRACT_VERSION = "1.1" as const;
export const SCHEMA_VERSION = "1" as const;
export const COLLECTION = "psychotherapy" as const;

export const ALLOWED_ENTRY_FIELDS = [
  "id",
  "title",
  "resource_type",
  "therapy_modality",
  "source_org",
  "canonical_url",
  "author",
  "published_date",
  "credibility_tier",
  "is_link_only",
  "citation_count",
  "oa_status",
  "doi",
  "pmid",
  "pmcid",
  "link_status",
  "link_checked_at",
  "updated_at",
  "audience",
  "authors_json",
] as const;

export type AllowedEntryField = (typeof ALLOWED_ENTRY_FIELDS)[number];

export const FORBIDDEN_FIELDS = [
  "notes",
  "file_path",
  "extracted_text_path",
  "abstract",
  "abstract_text",
  "rationale",
  "license",
  "content_hash",
  "body",
] as const;

export type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number];

export const LINK_STATUSES = ["ok", "blocked", "unchecked"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const CHECK_KINDS = ["identity", "legitimacy", "link"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/**
 * Phase 2A: derived at export time from `format`-category tags where
 * present, else from `resource_type` (see docs/publication-contract-v1.md's
 * v1.1 addendum for the exact mapping, mirrored in
 * export_allodium_snapshot.py::derive_audience()). "unknown" is a safety
 * net for a resource_type that fell outside both mapped sets, not an
 * intended steady state.
 */
export const AUDIENCE_VALUES = ["client", "clinician", "unknown"] as const;
export type AudienceValue = (typeof AUDIENCE_VALUES)[number];

/** One entry of the structured OpenAlex author list stored in
 * `entries.authors_json` (papers only; `null` for everything else). */
export type AuthorRecord = {
  name: string;
  orcid: string | null;
  institution: string | null;
  position: string;
};

export type PublicEntry = {
  id: string;
  title: string;
  resource_type: string;
  therapy_modality: string;
  source_org: string | null;
  canonical_url: string;
  author: string | null;
  published_date: string | null;
  credibility_tier: number;
  is_link_only: boolean;
  citation_count: number | null;
  oa_status: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  link_status: LinkStatus;
  link_checked_at: string | null;
  updated_at: string | null;
  audience: AudienceValue;
  authors: AuthorRecord[] | null;
  tags: Array<{ name: string; category: string }>;
  verifications: Array<{
    check_kind: CheckKind;
    result: string;
    method: string;
    method_version: string | null;
    score: number | null;
    checked_at: string | null;
  }>;
};

/**
 * Phase 2A: precomputed cosine-kNN row from `entry_neighbors`, rebuilt in
 * full on every snapshot import. Declared here now so the contract file
 * stays the single source of truth for every snapshot-produced shape, even
 * though no repository function reads this table until Phase 2C's
 * related-entries UI.
 */
export type EntryNeighbor = {
  neighbor_id: string;
  rank: number;
  score: number;
};

/**
 * Phase 2C: the public-safe join of an `entry_neighbors` row against its
 * `entries` row, used by the related-entries block on the entry page. Only
 * the fields the roadmap actually asks for (title, modality, link status) —
 * the raw `rank`/`score` ranking signal from `EntryNeighbor` is an internal
 * detail, not surfaced to readers.
 */
export type RelatedEntry = {
  id: string;
  title: string;
  therapy_modality: string;
  link_status: LinkStatus;
};

export type SearchHit = {
  id: string;
  title: string;
  resource_type: string;
  therapy_modality: string;
  source_org: string | null;
  link_status: LinkStatus;
  score: number | null;
};

/**
 * Shape of `snapshot_manifest.coverage_json`, computed once at snapshot-build
 * time in ACT's `export_allodium_snapshot.py::compute_coverage()` and stored
 * immutably so /standard/'s published numbers always describe exactly the
 * deployed snapshot. Inner keys are dynamic (whatever check_kind/result,
 * link_status, or therapy_modality values actually occur) — no hardcoded
 * enum on either side of the contract.
 */
export type CoverageStats = {
  total_entries: number;
  verifications: Record<string, Record<string, number>>;
  link_status: Record<string, number>;
  identifiers: Record<string, number>;
  modalities: Record<string, number>;
};

export type SnapshotManifest = {
  contract_version: string;
  schema_version: string;
  collection: string;
  source_generated_at: string;
  entry_count: number;
  tag_link_count: number;
  alias_count: number;
  checksum: string;
  abstract_search_enabled: boolean;
  exclusion_counts_json: string;
  coverage_json: CoverageStats;
};

export function assertNoForbiddenKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if ((FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`Forbidden public field present: ${key}`);
    }
  }
}

export function pickAllowedEntryFields(
  row: Record<string, unknown>,
): Record<AllowedEntryField, unknown> {
  const out = {} as Record<AllowedEntryField, unknown>;
  for (const field of ALLOWED_ENTRY_FIELDS) {
    out[field] = row[field] ?? null;
  }
  return out;
}
