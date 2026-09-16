/** Collection module publication contract v2 — collection-neutral D1 rows.
 * Psychotherapy continues to use src/contract.ts (v1.2). */

export const MODULE_CONTRACT_VERSION = "2" as const;
export const MODULE_SCHEMA_VERSION = "1" as const;

export const V2_ALLOWED_ENTRY_FIELDS = [
  "id",
  "title",
  "resource_type",
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
  "authors_json",
  "overview",
] as const;

export type V2AllowedEntryField = (typeof V2_ALLOWED_ENTRY_FIELDS)[number];

export const V2_FORBIDDEN_FIELDS = [
  "notes",
  "file_path",
  "extracted_text_path",
  "abstract",
  "abstract_text",
  "rationale",
  "license",
  "content_hash",
  "body",
  "therapy_modality",
] as const;

export type V2ForbiddenField = (typeof V2_FORBIDDEN_FIELDS)[number];

export const V2_LINK_STATUSES = ["ok", "blocked", "unchecked"] as const;
export type V2LinkStatus = (typeof V2_LINK_STATUSES)[number];

export const V2_CHECK_KINDS = ["identity", "legitimacy", "link"] as const;
export type V2CheckKind = (typeof V2_CHECK_KINDS)[number];

export type V2AuthorRecord = {
  name: string;
  orcid: string | null;
  institution: string | null;
  position: string;
};

export type V2PublicEntry = {
  id: string;
  title: string;
  resource_type: string;
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
  link_status: V2LinkStatus;
  link_checked_at: string | null;
  updated_at: string | null;
  authors: V2AuthorRecord[] | null;
  overview: string | null;
  tags: Array<{ name: string; category: string }>;
};

export type V2SearchHit = {
  id: string;
  title: string;
  resource_type: string;
  source_org: string | null;
  link_status: V2LinkStatus;
  published_date: string | null;
  citation_count: number | null;
  credibility_tier: number;
  score: number | null;
};

export type V2CoverageStats = {
  total_entries: number;
  verifications: Record<string, Record<string, number>>;
  link_status: Record<string, number>;
  identifiers: Record<string, number>;
  resource_types: Record<string, number>;
};

export type V2SnapshotManifest = {
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
  coverage_json: V2CoverageStats;
};

export function assertNoForbiddenV2Keys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if ((V2_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`Forbidden public field present: ${key}`);
    }
  }
}

export function pickAllowedV2EntryFields(
  row: Record<string, unknown>,
): Record<V2AllowedEntryField, unknown> {
  const out = {} as Record<V2AllowedEntryField, unknown>;
  for (const field of V2_ALLOWED_ENTRY_FIELDS) {
    out[field] = row[field] ?? null;
  }
  return out;
}

export function collectionBindingName(slug: string): string {
  return `COLLECTION_${slug.replace(/-/g, "_").toUpperCase()}`;
}
