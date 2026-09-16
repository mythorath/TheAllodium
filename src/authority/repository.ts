import type {
  AuthorityFamily,
  AuthorityHealth,
  AuthorityInstitution,
  AuthorityManifest,
  AuthorityPublisher,
  AuthorityVenue,
  BrowsePage,
  DoajSubjectLink,
  FieldPath,
  HubKind,
  HubWork,
  HubWorkAuthor,
  HubWorksByRank,
  IssnResolution,
  KeywordTopic,
  NamedCount,
  OrganizationSummary,
  PublisherSummary,
  RankKind,
  RetractionNotice,
  SubjectSummary,
  SubfieldPath,
  TaxonomyDomain,
  TaxonomyField,
  TaxonomySubfield,
  TaxonomyTopic,
  TopicPath,
  VenueSummary,
} from "./types";

const EXPECTED_FAMILIES: AuthorityFamily[] = ["openalex", "ror", "retraction_watch", "doaj", "nlm"];
const DEFAULT_MAX_AGE_DAYS = 120;
export const BROWSE_PAGE_SIZE = 50;
export const SITEMAP_PAGE_SIZE = 25_000;

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

type DomainRow = {
  id: string;
  display_name: string;
  description: string | null;
  works_count: number | null;
  cited_by_count: number | null;
};

type FieldRow = DomainRow & { domain_id: string };
type SubfieldRow = DomainRow & { field_id: string };
type TopicRow = DomainRow & { subfield_id: string; keywords_json: string };

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

export function encodeBrowseCursor(name: string, id: string): string {
  return `${name}\t${id}`;
}

export function decodeBrowseCursor(after: string | null): { name: string; id: string } | null {
  if (!after) return null;
  const tab = after.indexOf("\t");
  if (tab === -1) return { name: after, id: after };
  return { name: after.slice(0, tab), id: after.slice(tab + 1) };
}

function pageOf<T>(rows: T[], pageSize: number, cursorOf: (row: T) => string): BrowsePage<T> {
  if (rows.length <= pageSize) return { items: rows, nextAfter: null };
  const items = rows.slice(0, pageSize);
  const last = items[items.length - 1];
  if (!last) return { items, nextAfter: null };
  return { items, nextAfter: cursorOf(last) };
}

function mapDomain(row: DomainRow, fields: TaxonomyField[] = []): TaxonomyDomain {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    worksCount: row.works_count,
    citedByCount: row.cited_by_count,
    fields,
  };
}

function mapField(row: DomainRow, subfields: TaxonomySubfield[] = []): TaxonomyField {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    worksCount: row.works_count,
    citedByCount: row.cited_by_count,
    subfields,
  };
}

function mapSubfield(row: DomainRow, topics: TaxonomyTopic[] = []): TaxonomySubfield {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    worksCount: row.works_count,
    citedByCount: row.cited_by_count,
    topics,
  };
}

function mapTopic(row: TopicRow): TaxonomyTopic {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    keywords: parseJson<string[]>(row.keywords_json, []),
    worksCount: row.works_count,
    citedByCount: row.cited_by_count,
  };
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

function mapPublisher(row: PublisherRow | null): AuthorityPublisher | null {
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

function mapNotice(row: RetractionRow): RetractionNotice {
  return {
    id: row.id,
    doi: row.doi,
    originalPaperDoi: row.original_paper_doi,
    title: row.title,
    journal: row.journal,
    publisher: row.publisher,
    noticeType: row.notice_type,
    noticeDate: row.notice_date,
    reasons: parseJson<string[]>(row.reason_json, []),
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

const VENUE_DETAIL_SELECT = `
  SELECT s.id, s.display_name, s.issn_l, s.issns_json, s.publisher_id,
         s.source_type, s.is_oa, s.is_in_doaj, s.works_count, s.cited_by_count,
         s.homepage_url,
         EXISTS(
           SELECT 1 FROM oa_source_issns si
           JOIN doaj_journals d ON d.issn = si.issn OR d.eissn = si.issn
           WHERE si.source_id = s.id
         ) AS doaj_listed,
         (
           SELECT n.nlm_id FROM oa_source_issns si
           JOIN nlm_journals n
             ON n.issn_print = si.issn OR n.issn_electronic = si.issn OR n.issn_linking = si.issn
           WHERE si.source_id = s.id
           ORDER BY n.nlm_id LIMIT 1
         ) AS nlm_id
  FROM oa_sources s`;

const NOTICE_SELECT = `SELECT id, doi, original_paper_doi, title, journal, publisher,
                notice_type, notice_date, reason_json
         FROM retraction_watch_notices`;

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

export async function getVenue(db: D1Database, sourceId: string): Promise<AuthorityVenue | null> {
  const row = await db
    .prepare(`${VENUE_DETAIL_SELECT} WHERE s.id = ? LIMIT 1`)
    .bind(sourceId.trim())
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
  return mapPublisher(row);
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
        `${NOTICE_SELECT}
         WHERE doi = ? OR original_paper_doi = ?
         ORDER BY notice_date DESC, id`,
      )
      .bind(normalized, normalized)
      .all<RetractionRow>()
  ).results;
  return rows.map(mapNotice);
}

/**
 * Full four-level taxonomy. Reserved for sitemap generation; public field
 * routes use the scoped getters below so a single page does not load 4,516 topics.
 */
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

export async function getDomains(db: D1Database): Promise<TaxonomyDomain[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, description, works_count, cited_by_count
         FROM oa_domains ORDER BY display_name, id`,
      )
      .all<DomainRow>()
  ).results;
  return rows.map((row) => mapDomain(row));
}

export async function getDomainWithFields(
  db: D1Database,
  domainId: string,
): Promise<TaxonomyDomain | null> {
  const domain = await db
    .prepare(
      `SELECT id, display_name, description, works_count, cited_by_count
       FROM oa_domains WHERE id = ? LIMIT 1`,
    )
    .bind(domainId)
    .first<DomainRow>();
  if (!domain) return null;
  const fields = (
    await db
      .prepare(
        `SELECT id, display_name, description, works_count, cited_by_count
         FROM oa_fields WHERE domain_id = ? ORDER BY display_name, id`,
      )
      .bind(domainId)
      .all<DomainRow>()
  ).results;
  return mapDomain(domain, fields.map((field) => mapField(field)));
}

export async function getFieldWithSubfields(
  db: D1Database,
  domainId: string,
  fieldId: string,
): Promise<FieldPath | null> {
  const domain = await db
    .prepare(
      `SELECT id, display_name, description, works_count, cited_by_count
       FROM oa_domains WHERE id = ? LIMIT 1`,
    )
    .bind(domainId)
    .first<DomainRow>();
  if (!domain) return null;
  const field = await db
    .prepare(
      `SELECT id, domain_id, display_name, description, works_count, cited_by_count
       FROM oa_fields WHERE id = ? AND domain_id = ? LIMIT 1`,
    )
    .bind(fieldId, domainId)
    .first<FieldRow>();
  if (!field) return null;
  const subfields = (
    await db
      .prepare(
        `SELECT id, display_name, description, works_count, cited_by_count
         FROM oa_subfields WHERE field_id = ? ORDER BY display_name, id`,
      )
      .bind(fieldId)
      .all<DomainRow>()
  ).results;
  return {
    domain: mapDomain(domain),
    field: mapField(field, subfields.map((subfield) => mapSubfield(subfield))),
  };
}

export async function getSubfieldWithTopics(
  db: D1Database,
  domainId: string,
  fieldId: string,
  subfieldId: string,
): Promise<SubfieldPath | null> {
  const path = await getFieldWithSubfields(db, domainId, fieldId);
  if (!path) return null;
  const subfield = await db
    .prepare(
      `SELECT id, field_id, display_name, description, works_count, cited_by_count
       FROM oa_subfields WHERE id = ? AND field_id = ? LIMIT 1`,
    )
    .bind(subfieldId, fieldId)
    .first<SubfieldRow>();
  if (!subfield) return null;
  const topics = (
    await db
      .prepare(
        `SELECT id, subfield_id, display_name, description, keywords_json, works_count, cited_by_count
         FROM oa_topics WHERE subfield_id = ? ORDER BY display_name, id`,
      )
      .bind(subfieldId)
      .all<TopicRow>()
  ).results;
  return {
    domain: path.domain,
    field: path.field,
    subfield: mapSubfield(subfield, topics.map(mapTopic)),
  };
}

export async function getTopic(
  db: D1Database,
  domainId: string,
  fieldId: string,
  subfieldId: string,
  topicId: string,
): Promise<TopicPath | null> {
  const path = await getSubfieldWithTopics(db, domainId, fieldId, subfieldId);
  if (!path) return null;
  const topic = path.subfield.topics.find((item) => item.id === topicId);
  if (!topic) return null;
  return {
    ...path,
    topic,
    siblings: path.subfield.topics.filter((item) => item.id !== topicId),
  };
}

type HubWorkRow = {
  doi: string;
  title: string;
  authors_json: string;
  publication_year: number | null;
  publication_date: string | null;
  container_title: string | null;
  work_type: string | null;
  is_open_access: number | null;
  cited_by_count: number | null;
  canonical_url: string | null;
  openalex_id: string | null;
  fetched_at: string;
  rank: number;
  rank_kind: string;
  retracted: number;
};

function mapHubWorkAuthors(raw: string | null): HubWorkAuthor[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  const authors: HubWorkAuthor[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) authors.push({ name, orcid: null });
      continue;
    }
    if (item && typeof item === "object" && "name" in item) {
      const record = item as { name?: unknown; orcid?: unknown };
      const name = String(record.name ?? "").trim();
      if (!name) continue;
      authors.push({
        name,
        orcid: record.orcid == null || record.orcid === "" ? null : String(record.orcid),
      });
    }
  }
  return authors;
}

function parseRankKind(value: string): RankKind | null {
  if (value === "cited" || value === "recent") return value;
  return null;
}

function mapHubWork(row: HubWorkRow): HubWork | null {
  const rankKind = parseRankKind(row.rank_kind);
  if (!rankKind) return null;
  return {
    doi: row.doi,
    title: row.title,
    authors: mapHubWorkAuthors(row.authors_json),
    publicationYear: row.publication_year,
    publicationDate: row.publication_date,
    containerTitle: row.container_title,
    workType: row.work_type,
    isOpenAccess: row.is_open_access === null ? null : row.is_open_access === 1,
    citedByCount: row.cited_by_count,
    canonicalUrl: row.canonical_url,
    openalexId: row.openalex_id,
    fetchedAt: row.fetched_at,
    rank: row.rank,
    rankKind,
    retracted: row.retracted === 1,
  };
}

function splitHubWorks(works: HubWork[]): HubWorksByRank {
  const cited: HubWork[] = [];
  const recent: HubWork[] = [];
  for (const work of works) {
    switch (work.rankKind) {
      case "cited":
        cited.push(work);
        break;
      case "recent":
        recent.push(work);
        break;
      default: {
        const _never: never = work.rankKind;
        throw new Error(`unhandled rank_kind: ${_never}`);
      }
    }
  }
  return { cited, recent };
}

export async function getHubWorks(
  db: D1Database,
  hubKind: HubKind,
  hubId: string,
): Promise<HubWorksByRank> {
  const rows = (
    await db
      .prepare(
        `SELECT w.doi, w.title, w.authors_json, w.publication_year, w.publication_date,
                w.container_title, w.work_type, w.is_open_access, w.cited_by_count,
                w.canonical_url, w.openalex_id, w.fetched_at,
                h.rank, h.rank_kind,
                EXISTS(
                  SELECT 1 FROM retraction_watch_notices n
                  WHERE n.doi = w.doi OR n.original_paper_doi = w.doi
                ) AS retracted
         FROM hub_works h
         JOIN hub_work_records w ON w.doi = h.doi
         WHERE h.hub_kind = ? AND h.hub_id = ?
         ORDER BY h.rank_kind, h.rank`,
      )
      .bind(hubKind, hubId)
      .all<HubWorkRow>()
  ).results;
  const works: HubWork[] = [];
  for (const row of rows) {
    const work = mapHubWork(row);
    if (work) works.push(work);
  }
  return splitHubWorks(works);
}

export async function getSiblingDomains(
  db: D1Database,
  domainId: string,
): Promise<TaxonomyDomain[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, description, works_count, cited_by_count
         FROM oa_domains WHERE id != ? ORDER BY display_name, id`,
      )
      .bind(domainId)
      .all<DomainRow>()
  ).results;
  return rows.map((row) => mapDomain(row));
}

export async function getSiblingFields(
  db: D1Database,
  domainId: string,
  fieldId: string,
): Promise<TaxonomyField[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, description, works_count, cited_by_count
         FROM oa_fields WHERE domain_id = ? AND id != ? ORDER BY display_name, id`,
      )
      .bind(domainId, fieldId)
      .all<DomainRow>()
  ).results;
  return rows.map((row) => mapField(row));
}

export async function getSiblingSubfields(
  db: D1Database,
  fieldId: string,
  subfieldId: string,
): Promise<TaxonomySubfield[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, description, works_count, cited_by_count
         FROM oa_subfields WHERE field_id = ? AND id != ? ORDER BY display_name, id`,
      )
      .bind(fieldId, subfieldId)
      .all<DomainRow>()
  ).results;
  return rows.map((row) => mapSubfield(row));
}

export async function getSubfieldKeywords(
  db: D1Database,
  subfieldId: string,
  limit: number,
): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT k.keyword AS name, COUNT(*) AS count
         FROM oa_topics t
         JOIN oa_topic_keywords k ON k.topic_id = t.id
         WHERE t.subfield_id = ?
         GROUP BY k.keyword
         ORDER BY count DESC, k.keyword
         LIMIT ?`,
      )
      .bind(subfieldId, limit)
      .all<{ name: string; count: number }>()
  ).results;
  return rows;
}

export async function getRelatedKeywords(
  db: D1Database,
  keyword: string,
  limit: number,
): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT other.keyword AS name, COUNT(*) AS count
         FROM oa_topic_keywords seed
         JOIN oa_topic_keywords other
           ON other.topic_id = seed.topic_id AND other.keyword != seed.keyword
         WHERE seed.keyword = ?
         GROUP BY other.keyword
         ORDER BY count DESC, other.keyword
         LIMIT ?`,
      )
      .bind(keyword, limit)
      .all<{ name: string; count: number }>()
  ).results;
  return rows;
}

export async function getRelatedSubjects(
  db: D1Database,
  subject: string,
  limit: number,
): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT other.subject AS name, COUNT(*) AS count
         FROM doaj_journal_subjects seed
         JOIN doaj_journal_subjects other
           ON other.doaj_id = seed.doaj_id AND other.subject != seed.subject
         WHERE seed.subject = ?
         GROUP BY other.subject
         ORDER BY count DESC, other.subject
         LIMIT ?`,
      )
      .bind(subject, limit)
      .all<{ name: string; count: number }>()
  ).results;
  return rows;
}

export async function getRelatedReasons(
  db: D1Database,
  reason: string,
  limit: number,
): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT TRIM(j2.value) AS name, COUNT(DISTINCT n.id) AS count
         FROM retraction_watch_notices n,
              json_each(n.reason_json) j1,
              json_each(n.reason_json) j2
         WHERE TRIM(j1.value) = ?
           AND TRIM(j2.value) != ''
           AND TRIM(j2.value) != TRIM(j1.value)
         GROUP BY TRIM(j2.value)
         ORDER BY count DESC, name
         LIMIT ?`,
      )
      .bind(reason, limit)
      .all<{ name: string; count: number }>()
  ).results;
  return rows;
}

export async function getVenuesByPublisher(
  db: D1Database,
  publisherId: string,
  limit: number,
): Promise<VenueSummary[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, source_type, works_count
         FROM oa_sources WHERE publisher_id = ?
         ORDER BY display_name, id LIMIT ?`,
      )
      .bind(publisherId, limit)
      .all<{
        id: string;
        display_name: string;
        source_type: string | null;
        works_count: number | null;
      }>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    sourceType: row.source_type,
    worksCount: row.works_count,
  }));
}

export async function listVenueTypes(db: D1Database): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT COALESCE(source_type, '') AS name, COUNT(*) AS count
         FROM oa_sources GROUP BY source_type ORDER BY count DESC, name`,
      )
      .all<{ name: string; count: number }>()
  ).results;
  return rows.filter((row) => row.name.length > 0);
}

export async function listVenues(
  db: D1Database,
  options: { after?: string | null; type?: string | null; pageSize?: number } = {},
): Promise<BrowsePage<VenueSummary>> {
  const pageSize = options.pageSize ?? BROWSE_PAGE_SIZE;
  const cursor = decodeBrowseCursor(options.after ?? null);
  const type = options.type?.trim() || null;
  const bound: unknown[] = [];
  const where: string[] = [];
  if (type) {
    where.push("source_type = ?");
    bound.push(type);
  }
  if (cursor) {
    where.push("(display_name > ? OR (display_name = ? AND id > ?))");
    bound.push(cursor.name, cursor.name, cursor.id);
  }
  const sql = `SELECT id, display_name, source_type, works_count FROM oa_sources
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY display_name, id LIMIT ?`;
  bound.push(pageSize + 1);
  const rows = (await db.prepare(sql).bind(...bound).all<{
    id: string;
    display_name: string;
    source_type: string | null;
    works_count: number | null;
  }>()).results;
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      sourceType: row.source_type,
      worksCount: row.works_count,
    })),
    pageSize,
    (item) => encodeBrowseCursor(item.displayName, item.id),
  );
}

export async function listVenuesForPublisher(
  db: D1Database,
  publisherId: string,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<VenueSummary>> {
  const cursor = decodeBrowseCursor(after);
  const bound: unknown[] = [publisherId];
  let extra = "";
  if (cursor) {
    extra = "AND (display_name > ? OR (display_name = ? AND id > ?))";
    bound.push(cursor.name, cursor.name, cursor.id);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, source_type, works_count FROM oa_sources
         WHERE publisher_id = ? ${extra}
         ORDER BY display_name, id LIMIT ?`,
      )
      .bind(...bound)
      .all<{
        id: string;
        display_name: string;
        source_type: string | null;
        works_count: number | null;
      }>()
  ).results;
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      sourceType: row.source_type,
      worksCount: row.works_count,
    })),
    pageSize,
    (item) => encodeBrowseCursor(item.displayName, item.id),
  );
}

export async function listIssnResolutions(
  db: D1Database,
  sourceId: string,
): Promise<IssnResolution[]> {
  const rows = (
    await db
      .prepare(
        `SELECT si.issn,
                (SELECT d.id FROM doaj_journals d
                 WHERE d.issn = si.issn OR d.eissn = si.issn
                 ORDER BY d.id LIMIT 1) AS doaj_id,
                (SELECT d.title FROM doaj_journals d
                 WHERE d.issn = si.issn OR d.eissn = si.issn
                 ORDER BY d.id LIMIT 1) AS doaj_title,
                (SELECT n.nlm_id FROM nlm_journals n
                 WHERE n.issn_print = si.issn OR n.issn_electronic = si.issn
                    OR n.issn_linking = si.issn
                 ORDER BY n.nlm_id LIMIT 1) AS nlm_id,
                (SELECT n.title FROM nlm_journals n
                 WHERE n.issn_print = si.issn OR n.issn_electronic = si.issn
                    OR n.issn_linking = si.issn
                 ORDER BY n.nlm_id LIMIT 1) AS nlm_title
         FROM oa_source_issns si
         WHERE si.source_id = ?
         ORDER BY si.issn`,
      )
      .bind(sourceId)
      .all<{
        issn: string;
        doaj_id: string | null;
        doaj_title: string | null;
        nlm_id: string | null;
        nlm_title: string | null;
      }>()
  ).results;
  return rows.map((row) => ({
    issn: row.issn,
    doajId: row.doaj_id,
    doajTitle: row.doaj_title,
    nlmId: row.nlm_id,
    nlmTitle: row.nlm_title,
  }));
}

export async function listVenueSubjects(db: D1Database, sourceId: string): Promise<DoajSubjectLink[]> {
  const rows = (
    await db
      .prepare(
        `SELECT DISTINCT djs.subject AS subject
         FROM oa_source_issns si
         JOIN doaj_journals d ON d.issn = si.issn OR d.eissn = si.issn
         JOIN doaj_journal_subjects djs ON djs.doaj_id = d.id
         WHERE si.source_id = ?
         ORDER BY djs.subject`,
      )
      .bind(sourceId)
      .all<{ subject: string }>()
  ).results;
  return rows.map((row) => ({ subject: row.subject }));
}

export async function listPublishers(
  db: D1Database,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<PublisherSummary>> {
  const cursor = decodeBrowseCursor(after);
  const bound: unknown[] = [];
  let where = "";
  if (cursor) {
    where = "WHERE display_name > ? OR (display_name = ? AND id > ?)";
    bound.push(cursor.name, cursor.name, cursor.id);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, works_count, parent_publisher_id
         FROM oa_publishers ${where}
         ORDER BY display_name, id LIMIT ?`,
      )
      .bind(...bound)
      .all<{
        id: string;
        display_name: string;
        works_count: number | null;
        parent_publisher_id: string | null;
      }>()
  ).results;
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      worksCount: row.works_count,
      parentPublisherId: row.parent_publisher_id,
    })),
    pageSize,
    (item) => encodeBrowseCursor(item.displayName, item.id),
  );
}

export async function listPublisherChildren(
  db: D1Database,
  publisherId: string,
): Promise<PublisherSummary[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, works_count, parent_publisher_id
         FROM oa_publishers WHERE parent_publisher_id = ?
         ORDER BY display_name, id`,
      )
      .bind(publisherId)
      .all<{
        id: string;
        display_name: string;
        works_count: number | null;
        parent_publisher_id: string | null;
      }>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    worksCount: row.works_count,
    parentPublisherId: row.parent_publisher_id,
  }));
}

export async function listOrganizations(
  db: D1Database,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<OrganizationSummary>> {
  const cursor = decodeBrowseCursor(after);
  const bound: unknown[] = [];
  let where = "";
  if (cursor) {
    where = "WHERE display_name > ? OR (display_name = ? AND id > ?)";
    bound.push(cursor.name, cursor.name, cursor.id);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, country_code, organization_types_json
         FROM ror_organizations ${where}
         ORDER BY display_name, id LIMIT ?`,
      )
      .bind(...bound)
      .all<{
        id: string;
        display_name: string;
        country_code: string | null;
        organization_types_json: string;
      }>()
  ).results;
  return pageOf(
    rows.map((row) => ({
      rorId: row.id,
      displayName: row.display_name,
      countryCode: row.country_code,
      organizationTypes: parseJson<string[]>(row.organization_types_json, []),
    })),
    pageSize,
    (item) => encodeBrowseCursor(item.displayName, item.rorId),
  );
}

export async function listOrganizationCountries(db: D1Database): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT country_code AS name, COUNT(*) AS count
         FROM ror_organizations
         WHERE country_code IS NOT NULL AND country_code != ''
         GROUP BY country_code ORDER BY country_code`,
      )
      .all<{ name: string; count: number }>()
  ).results;
  return rows;
}

export async function listOrganizationsByCountry(
  db: D1Database,
  countryCode: string,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<OrganizationSummary>> {
  const code = countryCode.trim().toUpperCase();
  const cursor = decodeBrowseCursor(after);
  const bound: unknown[] = [code];
  let extra = "";
  if (cursor) {
    extra = "AND (display_name > ? OR (display_name = ? AND id > ?))";
    bound.push(cursor.name, cursor.name, cursor.id);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, country_code, organization_types_json
         FROM ror_organizations
         WHERE country_code = ? ${extra}
         ORDER BY display_name, id LIMIT ?`,
      )
      .bind(...bound)
      .all<{
        id: string;
        display_name: string;
        country_code: string | null;
        organization_types_json: string;
      }>()
  ).results;
  return pageOf(
    rows.map((row) => ({
      rorId: row.id,
      displayName: row.display_name,
      countryCode: row.country_code,
      organizationTypes: parseJson<string[]>(row.organization_types_json, []),
    })),
    pageSize,
    (item) => encodeBrowseCursor(item.displayName, item.rorId),
  );
}

export async function listCountryPeers(
  db: D1Database,
  countryCode: string,
  excludeRor: string,
  limit = 12,
): Promise<OrganizationSummary[]> {
  const code = countryCode.trim().toUpperCase();
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, country_code, organization_types_json
         FROM ror_organizations
         WHERE country_code = ? AND id != ? AND id != ?
         ORDER BY display_name, id LIMIT ?`,
      )
      .bind(code, excludeRor, `https://ror.org/${excludeRor.replace(/^https?:\/\/ror\.org\//i, "")}`, limit)
      .all<{
        id: string;
        display_name: string;
        country_code: string | null;
        organization_types_json: string;
      }>()
  ).results;
  return rows.map((row) => ({
    rorId: row.id,
    displayName: row.display_name,
    countryCode: row.country_code,
    organizationTypes: parseJson<string[]>(row.organization_types_json, []),
  }));
}

export async function listKeywords(
  db: D1Database,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<NamedCount>> {
  const bound: unknown[] = [];
  let havingAfter = "";
  if (after) {
    havingAfter = "AND keyword > ?";
    bound.push(after);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT keyword AS name, COUNT(*) AS count
         FROM oa_topic_keywords
         GROUP BY keyword
         HAVING COUNT(*) >= 1 ${havingAfter}
         ORDER BY keyword LIMIT ?`,
      )
      .bind(...bound)
      .all<{ name: string; count: number }>()
  ).results;
  return pageOf(rows, pageSize, (item) => item.name);
}

export async function listTopicsForKeyword(db: D1Database, keyword: string): Promise<KeywordTopic[]> {
  const rows = (
    await db
      .prepare(
        `SELECT t.id, t.display_name, t.works_count,
                d.id AS domain_id, d.display_name AS domain_name,
                f.id AS field_id, f.display_name AS field_name,
                s.id AS subfield_id, s.display_name AS subfield_name
         FROM oa_topic_keywords k
         JOIN oa_topics t ON t.id = k.topic_id
         JOIN oa_subfields s ON s.id = t.subfield_id
         JOIN oa_fields f ON f.id = s.field_id
         JOIN oa_domains d ON d.id = f.domain_id
         WHERE k.keyword = ?
         ORDER BY d.display_name, f.display_name, s.display_name, t.display_name, t.id`,
      )
      .bind(keyword)
      .all<{
        id: string;
        display_name: string;
        works_count: number | null;
        domain_id: string;
        domain_name: string;
        field_id: string;
        field_name: string;
        subfield_id: string;
        subfield_name: string;
      }>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    domainId: row.domain_id,
    domainName: row.domain_name,
    fieldId: row.field_id,
    fieldName: row.field_name,
    subfieldId: row.subfield_id,
    subfieldName: row.subfield_name,
    worksCount: row.works_count,
  }));
}

export async function listDoajSubjects(
  db: D1Database,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<SubjectSummary>> {
  const bound: unknown[] = [];
  let extra = "";
  if (after) {
    extra = "HAVING subject > ?";
    bound.push(after);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT subject, COUNT(*) AS journal_count
         FROM doaj_journal_subjects
         GROUP BY subject
         ${extra}
         ORDER BY subject LIMIT ?`,
      )
      .bind(...bound)
      .all<{ subject: string; journal_count: number }>()
  ).results;
  return pageOf(
    rows.map((row) => ({ subject: row.subject, journalCount: row.journal_count })),
    pageSize,
    (item) => item.subject,
  );
}

export async function listVenuesForSubject(
  db: D1Database,
  subject: string,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<VenueSummary>> {
  const cursor = decodeBrowseCursor(after);
  const bound: unknown[] = [subject];
  let extra = "";
  if (cursor) {
    extra = "AND (s.display_name > ? OR (s.display_name = ? AND s.id > ?))";
    bound.push(cursor.name, cursor.name, cursor.id);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT DISTINCT s.id, s.display_name, s.source_type, s.works_count
         FROM doaj_journal_subjects djs
         JOIN doaj_journals d ON d.id = djs.doaj_id
         JOIN oa_source_issns si ON si.issn = d.issn OR si.issn = d.eissn
         JOIN oa_sources s ON s.id = si.source_id
         WHERE djs.subject = ? ${extra}
         ORDER BY s.display_name, s.id LIMIT ?`,
      )
      .bind(...bound)
      .all<{
        id: string;
        display_name: string;
        source_type: string | null;
        works_count: number | null;
      }>()
  ).results;
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      sourceType: row.source_type,
      worksCount: row.works_count,
    })),
    pageSize,
    (item) => encodeBrowseCursor(item.displayName, item.id),
  );
}

export async function listRetractionNotices(
  db: D1Database,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<RetractionNotice>> {
  const bound: unknown[] = [];
  let where = "";
  if (after) {
    where = "WHERE id > ?";
    bound.push(after);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(`${NOTICE_SELECT} ${where} ORDER BY id LIMIT ?`)
      .bind(...bound)
      .all<RetractionRow>()
  ).results;
  return pageOf(rows.map(mapNotice), pageSize, (item) => item.id);
}

export async function getRetractionNotice(
  db: D1Database,
  noticeId: string,
): Promise<RetractionNotice | null> {
  const row = await db
    .prepare(`${NOTICE_SELECT} WHERE id = ? LIMIT 1`)
    .bind(noticeId)
    .first<RetractionRow>();
  return row ? mapNotice(row) : null;
}

export async function getFederatedOverview(
  db: D1Database,
  doi: string,
): Promise<string | null> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return null;
  const row = await db
    .prepare(
      `SELECT overview FROM federated_work_overviews WHERE doi = ? LIMIT 1`,
    )
    .bind(normalized)
    .first<{ overview: string }>();
  const overview = row?.overview?.trim();
  return overview ? overview : null;
}

export async function listRetractionReasons(db: D1Database): Promise<NamedCount[]> {
  const rows = (
    await db
      .prepare(
        `SELECT TRIM(j.value) AS name, COUNT(*) AS count
         FROM retraction_watch_notices n, json_each(n.reason_json) j
         WHERE typeof(j.value) IN ('text', 'integer', 'real') AND TRIM(j.value) != ''
         GROUP BY TRIM(j.value)
         ORDER BY count DESC, name`,
      )
      .all<{ name: string; count: number }>()
  ).results;
  return rows;
}

export async function listNoticesByReason(
  db: D1Database,
  reason: string,
  after: string | null = null,
  pageSize = BROWSE_PAGE_SIZE,
): Promise<BrowsePage<RetractionNotice>> {
  const bound: unknown[] = [reason];
  let extra = "";
  if (after) {
    extra = "AND n.id > ?";
    bound.push(after);
  }
  bound.push(pageSize + 1);
  const rows = (
    await db
      .prepare(
        `SELECT n.id, n.doi, n.original_paper_doi, n.title, n.journal, n.publisher,
                n.notice_type, n.notice_date, n.reason_json
         FROM retraction_watch_notices n, json_each(n.reason_json) j
         WHERE TRIM(j.value) = ? ${extra}
         ORDER BY n.id LIMIT ?`,
      )
      .bind(...bound)
      .all<RetractionRow>()
  ).results;
  return pageOf(rows.map(mapNotice), pageSize, (item) => item.id);
}

export async function listNoticesForJournal(
  db: D1Database,
  journal: string,
  pageSize = 25,
): Promise<RetractionNotice[]> {
  const rows = (
    await db
      .prepare(
        `${NOTICE_SELECT} WHERE journal = ? ORDER BY notice_date DESC, id LIMIT ?`,
      )
      .bind(journal, pageSize)
      .all<RetractionRow>()
  ).results;
  return rows.map(mapNotice);
}

export async function findVenuesByName(
  db: D1Database,
  name: string,
  limit = 5,
): Promise<VenueSummary[]> {
  const rows = (
    await db
      .prepare(
        `SELECT id, display_name, source_type, works_count
         FROM oa_sources WHERE display_name = ? ORDER BY id LIMIT ?`,
      )
      .bind(name, limit)
      .all<{
        id: string;
        display_name: string;
        source_type: string | null;
        works_count: number | null;
      }>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    sourceType: row.source_type,
    worksCount: row.works_count,
  }));
}

export async function hasDoajSubject(db: D1Database, subject: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS n FROM doaj_journal_subjects WHERE subject = ? LIMIT 1`)
    .bind(subject)
    .first<{ n: number }>();
  return row !== null;
}

async function countSql(db: D1Database, sql: string): Promise<number> {
  const row = await db.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countVenues(db: D1Database): Promise<number> {
  return countSql(db, "SELECT COUNT(*) AS n FROM oa_sources");
}

export async function countPublishers(db: D1Database): Promise<number> {
  return countSql(db, "SELECT COUNT(*) AS n FROM oa_publishers");
}

export async function countOrganizations(db: D1Database): Promise<number> {
  return countSql(db, "SELECT COUNT(*) AS n FROM ror_organizations");
}

export async function countRetractionNotices(db: D1Database): Promise<number> {
  return countSql(db, "SELECT COUNT(*) AS n FROM retraction_watch_notices");
}

export async function countDoajSubjects(db: D1Database): Promise<number> {
  return countSql(db, "SELECT COUNT(*) AS n FROM (SELECT subject FROM doaj_journal_subjects GROUP BY subject)");
}

export async function countSharedKeywords(db: D1Database): Promise<number> {
  return countSql(
    db,
    "SELECT COUNT(*) AS n FROM (SELECT keyword FROM oa_topic_keywords GROUP BY keyword HAVING COUNT(*) >= 2)",
  );
}

async function keysetIds(
  db: D1Database,
  startSql: string,
  pageSql: string,
  pageSqlFromStart: string,
  page: number,
  pageSize: number,
): Promise<string[] | null> {
  if (page < 0) return null;
  if (page === 0) {
    const rows = (await db.prepare(pageSql).bind(pageSize).all<{ id: string }>()).results;
    return rows.map((row) => row.id);
  }
  const start = await db.prepare(startSql).bind(page * pageSize).first<{ id: string }>();
  if (!start) return null;
  const rows = (
    await db.prepare(pageSqlFromStart).bind(start.id, pageSize).all<{ id: string }>()
  ).results;
  return rows.map((row) => row.id);
}

export async function listVenueIdsPage(
  db: D1Database,
  page: number,
  pageSize = SITEMAP_PAGE_SIZE,
): Promise<string[] | null> {
  return keysetIds(
    db,
    "SELECT id FROM oa_sources ORDER BY id LIMIT 1 OFFSET ?",
    "SELECT id FROM oa_sources ORDER BY id LIMIT ?",
    "SELECT id FROM oa_sources WHERE id >= ? ORDER BY id LIMIT ?",
    page,
    pageSize,
  );
}

export async function listPublisherIdsPage(
  db: D1Database,
  page: number,
  pageSize = SITEMAP_PAGE_SIZE,
): Promise<string[] | null> {
  return keysetIds(
    db,
    "SELECT id FROM oa_publishers ORDER BY id LIMIT 1 OFFSET ?",
    "SELECT id FROM oa_publishers ORDER BY id LIMIT ?",
    "SELECT id FROM oa_publishers WHERE id >= ? ORDER BY id LIMIT ?",
    page,
    pageSize,
  );
}

export async function listOrganizationIdsPage(
  db: D1Database,
  page: number,
  pageSize = SITEMAP_PAGE_SIZE,
): Promise<string[] | null> {
  return keysetIds(
    db,
    "SELECT id FROM ror_organizations ORDER BY id LIMIT 1 OFFSET ?",
    "SELECT id FROM ror_organizations ORDER BY id LIMIT ?",
    "SELECT id FROM ror_organizations WHERE id >= ? ORDER BY id LIMIT ?",
    page,
    pageSize,
  );
}

export async function listRetractionIdsPage(
  db: D1Database,
  page: number,
  pageSize = SITEMAP_PAGE_SIZE,
): Promise<string[] | null> {
  return keysetIds(
    db,
    "SELECT id FROM retraction_watch_notices ORDER BY id LIMIT 1 OFFSET ?",
    "SELECT id FROM retraction_watch_notices ORDER BY id LIMIT ?",
    "SELECT id FROM retraction_watch_notices WHERE id >= ? ORDER BY id LIMIT ?",
    page,
    pageSize,
  );
}

export async function listSharedKeywordPage(
  db: D1Database,
  page: number,
  pageSize = SITEMAP_PAGE_SIZE,
): Promise<string[] | null> {
  const sql = `SELECT keyword AS id FROM oa_topic_keywords
    GROUP BY keyword HAVING COUNT(*) >= 2 ORDER BY keyword`;
  if (page < 0) return null;
  if (page === 0) {
    const rows = (await db.prepare(`${sql} LIMIT ?`).bind(pageSize).all<{ id: string }>()).results;
    return rows.map((row) => row.id);
  }
  const start = await db
    .prepare(`${sql} LIMIT 1 OFFSET ?`)
    .bind(page * pageSize)
    .first<{ id: string }>();
  if (!start) return null;
  const rows = (
    await db
      .prepare(
        `SELECT keyword AS id FROM oa_topic_keywords
         GROUP BY keyword HAVING COUNT(*) >= 2 AND keyword >= ?
         ORDER BY keyword LIMIT ?`,
      )
      .bind(start.id, pageSize)
      .all<{ id: string }>()
  ).results;
  return rows.map((row) => row.id);
}

export async function listSubjectPage(
  db: D1Database,
  page: number,
  pageSize = SITEMAP_PAGE_SIZE,
): Promise<string[] | null> {
  const sql = `SELECT subject AS id FROM doaj_journal_subjects GROUP BY subject ORDER BY subject`;
  if (page < 0) return null;
  if (page === 0) {
    const rows = (await db.prepare(`${sql} LIMIT ?`).bind(pageSize).all<{ id: string }>()).results;
    return rows.map((row) => row.id);
  }
  const start = await db
    .prepare(`${sql} LIMIT 1 OFFSET ?`)
    .bind(page * pageSize)
    .first<{ id: string }>();
  if (!start) return null;
  const rows = (
    await db
      .prepare(
        `SELECT subject AS id FROM doaj_journal_subjects
         GROUP BY subject HAVING subject >= ?
         ORDER BY subject LIMIT ?`,
      )
      .bind(start.id, pageSize)
      .all<{ id: string }>()
  ).results;
  return rows.map((row) => row.id);
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
