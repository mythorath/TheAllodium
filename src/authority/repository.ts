import type {
  AuthorityFamily,
  AuthorityHealth,
  AuthorityInstitution,
  AuthorityManifest,
  AuthorityPublisher,
  AuthorityVenue,
  RetractionNotice,
  TaxonomyDomain,
  TaxonomyField,
  TaxonomySubfield,
  TaxonomyTopic,
} from "./types";

const EXPECTED_FAMILIES: AuthorityFamily[] = ["openalex", "ror", "retraction_watch", "doaj", "nlm"];
const DEFAULT_MAX_AGE_DAYS = 120;

type VenueRow = {
  id: string;
  display_name: string;
  issn_l: string | null;
  issns_json: string;
  publisher_id: string | null;
  source_type: string | null;
  is_oa: number | null;
  is_in_doaj: number | null;
  works_count: number | null;
  cited_by_count: number | null;
  homepage_url: string | null;
  doaj_listed: number;
  nlm_id: string | null;
};

type PublisherRow = {
  id: string;
  display_name: string;
  alternate_titles_json: string;
  country_codes_json: string;
  hierarchy_level: number | null;
  parent_publisher_id: string | null;
  works_count: number | null;
  cited_by_count: number | null;
};

type InstitutionRow = {
  openalex_id: string | null;
  ror_id: string | null;
  display_name: string;
  country_code: string | null;
  institution_type: string | null;
  organization_types_json: string | null;
  status: string | null;
  website_url: string | null;
};

type RetractionRow = {
  id: string;
  doi: string | null;
  original_paper_doi: string | null;
  title: string;
  journal: string | null;
  publisher: string | null;
  notice_type: string;
  notice_date: string | null;
  reason_json: string;
};

type ManifestRow = {
  family: AuthorityFamily;
  snapshot_id: string;
  schema_version: number;
  source_name: string;
  source_url: string;
  license_name: string;
  license_url: string;
  fetched_at: string;
  source_checksum_sha256: string;
  row_count: number;
  metadata_json: string;
  imported_at: string;
};

type TaxonomyRow = {
  domain_id: string;
  domain_name: string;
  domain_description: string | null;
  domain_works_count: number | null;
  domain_cited_by_count: number | null;
  field_id: string | null;
  field_name: string | null;
  field_description: string | null;
  field_works_count: number | null;
  field_cited_by_count: number | null;
  subfield_id: string | null;
  subfield_name: string | null;
  subfield_description: string | null;
  subfield_works_count: number | null;
  subfield_cited_by_count: number | null;
  topic_id: string | null;
  topic_name: string | null;
  topic_description: string | null;
  topic_keywords_json: string | null;
  topic_works_count: number | null;
  topic_cited_by_count: number | null;
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function normalizeIssn(value: string): string {
  const compact = value.trim().replace(/[^0-9x]/gi, "").toUpperCase();
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function mapVenue(row: VenueRow | null): AuthorityVenue | null {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    issnL: row.issn_l,
    issns: parseJson<string[]>(row.issns_json, []),
    publisherId: row.publisher_id,
    sourceType: row.source_type,
    isOpenAccess: row.is_oa === null ? null : row.is_oa === 1,
    isInDoaj: row.is_in_doaj === null ? null : row.is_in_doaj === 1,
    worksCount: row.works_count,
    citedByCount: row.cited_by_count,
    homepageUrl: row.homepage_url,
    doajListed: row.doaj_listed === 1,
    nlmId: row.nlm_id,
  };
}

const VENUE_SELECT = `
  SELECT s.id, s.display_name, s.issn_l, s.issns_json, s.publisher_id,
         s.source_type, s.is_oa, s.is_in_doaj, s.works_count, s.cited_by_count,
         s.homepage_url,
         EXISTS(
           SELECT 1 FROM doaj_journals d WHERE d.issn = ?1 OR d.eissn = ?1
         ) AS doaj_listed,
         (
           SELECT n.nlm_id FROM nlm_journals n
           WHERE n.issn_print = ?1 OR n.issn_electronic = ?1 OR n.issn_linking = ?1
           ORDER BY n.nlm_id LIMIT 1
         ) AS nlm_id
  FROM oa_sources s`;

export async function getVenueByIssn(
  db: D1Database,
  issn: string,
): Promise<AuthorityVenue | null> {
  const normalized = normalizeIssn(issn);
  const row = await db
    .prepare(`${VENUE_SELECT} JOIN oa_source_issns si ON si.source_id = s.id WHERE si.issn = ?1 LIMIT 1`)
    .bind(normalized)
    .first<VenueRow>();
  return mapVenue(row);
}

/** Looks up the OpenAlex source ID returned by DOI resolution APIs. */
export async function getVenueBySourceId(
  db: D1Database,
  sourceId: string,
): Promise<AuthorityVenue | null> {
  const row = await db
    .prepare(`${VENUE_SELECT} WHERE s.id = ?2 LIMIT 1`)
    .bind("", sourceId.trim())
    .first<VenueRow>();
  return mapVenue(row);
}

export async function getPublisher(
  db: D1Database,
  publisherId: string,
): Promise<AuthorityPublisher | null> {
  const row = await db
    .prepare(
      `SELECT id, display_name, alternate_titles_json, country_codes_json,
              hierarchy_level, parent_publisher_id, works_count, cited_by_count
       FROM oa_publishers WHERE id = ?`,
    )
    .bind(publisherId.trim())
    .first<PublisherRow>();
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    alternateTitles: parseJson<string[]>(row.alternate_titles_json, []),
    countryCodes: parseJson<string[]>(row.country_codes_json, []),
    hierarchyLevel: row.hierarchy_level,
    parentPublisherId: row.parent_publisher_id,
    worksCount: row.works_count,
    citedByCount: row.cited_by_count,
  };
}

export async function getInstitutionByRor(
  db: D1Database,
  rorId: string,
): Promise<AuthorityInstitution | null> {
  const normalized = rorId.trim().replace(/^https?:\/\/ror\.org\//i, "");
  const row = await db
    .prepare(
      `SELECT oi.id AS openalex_id, COALESCE(oi.ror_id, r.id) AS ror_id,
              COALESCE(oi.display_name, r.display_name) AS display_name,
              COALESCE(oi.country_code, r.country_code) AS country_code,
              oi.institution_type, r.organization_types_json, r.status, r.website_url
       FROM ror_organizations r
       LEFT JOIN oa_institutions oi ON oi.ror_id = r.id
       WHERE r.id = ? OR r.id = ? LIMIT 1`,
    )
    .bind(normalized, `https://ror.org/${normalized}`)
    .first<InstitutionRow>();
  return mapInstitution(row);
}

/** Looks up an institution using the institution ID returned by DOI resolution. */
export async function getInstitutionByOpenAlexId(
  db: D1Database,
  institutionId: string,
): Promise<AuthorityInstitution | null> {
  const row = await db
    .prepare(
      `SELECT oi.id AS openalex_id, oi.ror_id,
              oi.display_name, oi.country_code, oi.institution_type,
              r.organization_types_json, r.status, r.website_url
       FROM oa_institutions oi
       LEFT JOIN ror_organizations r
         ON replace(r.id, 'https://ror.org/', '') =
            replace(oi.ror_id, 'https://ror.org/', '')
       WHERE oi.id = ? LIMIT 1`,
    )
    .bind(institutionId.trim())
    .first<InstitutionRow>();
  return mapInstitution(row);
}

function mapInstitution(row: InstitutionRow | null): AuthorityInstitution | null {
  if (!row) return null;
  return {
    openAlexId: row.openalex_id,
    rorId: row.ror_id,
    displayName: row.display_name,
    countryCode: row.country_code,
    institutionType: row.institution_type,
    organizationTypes: parseJson<string[]>(row.organization_types_json, []),
    status: row.status,
    websiteUrl: row.website_url,
  };
}

export async function getRetractionsByDoi(
  db: D1Database,
  doi: string,
): Promise<RetractionNotice[]> {
  const normalized = normalizeDoi(doi);
  const rows = (
    await db
      .prepare(
        `SELECT id, doi, original_paper_doi, title, journal, publisher,
                notice_type, notice_date, reason_json
         FROM retraction_watch_notices
         WHERE doi = ? OR original_paper_doi = ?
         ORDER BY notice_date DESC, id`,
      )
      .bind(normalized, normalized)
      .all<RetractionRow>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    doi: row.doi,
    originalPaperDoi: row.original_paper_doi,
    title: row.title,
    journal: row.journal,
    publisher: row.publisher,
    noticeType: row.notice_type,
    noticeDate: row.notice_date,
    reasons: parseJson<string[]>(row.reason_json, []),
  }));
}

export async function listTaxonomyHierarchy(db: D1Database): Promise<TaxonomyDomain[]> {
  const rows = (
    await db
      .prepare(
        `SELECT d.id AS domain_id, d.display_name AS domain_name,
                d.description AS domain_description, d.works_count AS domain_works_count,
                d.cited_by_count AS domain_cited_by_count,
                f.id AS field_id, f.display_name AS field_name,
                f.description AS field_description, f.works_count AS field_works_count,
                f.cited_by_count AS field_cited_by_count,
                s.id AS subfield_id, s.display_name AS subfield_name,
                s.description AS subfield_description, s.works_count AS subfield_works_count,
                s.cited_by_count AS subfield_cited_by_count,
                t.id AS topic_id, t.display_name AS topic_name,
                t.description AS topic_description, t.keywords_json AS topic_keywords_json,
                t.works_count AS topic_works_count, t.cited_by_count AS topic_cited_by_count
         FROM oa_domains d
         LEFT JOIN oa_fields f ON f.domain_id = d.id
         LEFT JOIN oa_subfields s ON s.field_id = f.id
         LEFT JOIN oa_topics t ON t.subfield_id = s.id
         ORDER BY d.display_name, d.id, f.display_name, f.id,
                  s.display_name, s.id, t.display_name, t.id`,
      )
      .all<TaxonomyRow>()
  ).results;
  return foldTaxonomyRows(rows);
}

export function foldTaxonomyRows(rows: TaxonomyRow[]): TaxonomyDomain[] {
  const domains = new Map<string, TaxonomyDomain>();
  const fields = new Map<string, TaxonomyField>();
  const subfields = new Map<string, TaxonomySubfield>();
  for (const row of rows) {
    let domain = domains.get(row.domain_id);
    if (!domain) {
      domain = {
        id: row.domain_id,
        displayName: row.domain_name,
        description: row.domain_description,
        worksCount: row.domain_works_count,
        citedByCount: row.domain_cited_by_count,
        fields: [],
      };
      domains.set(domain.id, domain);
    }
    if (!row.field_id || !row.field_name) continue;
    let field = fields.get(row.field_id);
    if (!field) {
      field = {
        id: row.field_id,
        displayName: row.field_name,
        description: row.field_description,
        worksCount: row.field_works_count,
        citedByCount: row.field_cited_by_count,
        subfields: [],
      };
      fields.set(field.id, field);
      domain.fields.push(field);
    }
    if (!row.subfield_id || !row.subfield_name) continue;
    let subfield = subfields.get(row.subfield_id);
    if (!subfield) {
      subfield = {
        id: row.subfield_id,
        displayName: row.subfield_name,
        description: row.subfield_description,
        worksCount: row.subfield_works_count,
        citedByCount: row.subfield_cited_by_count,
        topics: [],
      };
      subfields.set(subfield.id, subfield);
      field.subfields.push(subfield);
    }
    if (row.topic_id && row.topic_name) {
      const topic: TaxonomyTopic = {
        id: row.topic_id,
        displayName: row.topic_name,
        description: row.topic_description,
        keywords: parseJson<string[]>(row.topic_keywords_json, []),
        worksCount: row.topic_works_count,
        citedByCount: row.topic_cited_by_count,
      };
      subfield.topics.push(topic);
    }
  }
  return [...domains.values()];
}

/**
 * Whether a data family is actually present in the deployed snapshot. Callers
 * must consult this before reporting a "no match" result: an unloaded family
 * yields zero rows, which is unchecked, not a clean bill of health.
 */
export async function hasAuthorityFamily(
  db: D1Database,
  family: AuthorityFamily,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM authority_manifest
       WHERE family = ? AND row_count > 0 LIMIT 1`,
    )
    .bind(family)
    .first<{ present: number }>();
  return row !== null;
}

export async function getAuthorityManifests(db: D1Database): Promise<AuthorityManifest[]> {
  const rows = (
    await db
      .prepare(
        `SELECT family, snapshot_id, schema_version, source_name, source_url,
                license_name, license_url, fetched_at, source_checksum_sha256,
                row_count, metadata_json, imported_at
         FROM authority_manifest ORDER BY family`,
      )
      .all<ManifestRow>()
  ).results;
  return rows.map((row) => ({
    family: row.family,
    snapshotId: row.snapshot_id,
    schemaVersion: row.schema_version,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    licenseName: row.license_name,
    licenseUrl: row.license_url,
    fetchedAt: row.fetched_at,
    sourceChecksumSha256: row.source_checksum_sha256,
    rowCount: row.row_count,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    importedAt: row.imported_at,
  }));
}

export async function getAuthorityHealth(
  db: D1Database,
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
): Promise<AuthorityHealth> {
  const manifests = await getAuthorityManifests(db);
  const present = new Set(manifests.map((manifest) => manifest.family));
  const missingFamilies = EXPECTED_FAMILIES.filter((family) => !present.has(family));
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const staleFamilies = manifests
    .filter((manifest) => {
      const fetched = Date.parse(manifest.fetchedAt);
      return !Number.isFinite(fetched) || fetched < cutoff;
    })
    .map((manifest) => manifest.family);
  return {
    healthy: missingFamilies.length === 0 && staleFamilies.length === 0,
    expectedFamilies: [...EXPECTED_FAMILIES],
    missingFamilies,
    staleFamilies,
    manifests,
  };
}
