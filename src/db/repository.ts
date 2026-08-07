import type {
  AudienceValue,
  AuthorRecord,
  CheckKind,
  CoverageStats,
  LinkStatus,
  PublicEntry,
  RelatedEntry,
  SearchHit,
  SnapshotManifest,
} from "../contract";
import { assertNoForbiddenKeys } from "../contract";
import type { FacetCounts, FacetFilters } from "./facets";
import { EMPTY_FACET_FILTERS, buildFacetWhere, computeFacetCounts, hasActiveFilters } from "./facets";

export type { FacetFilters, AccessValue, StorageValue } from "./facets";

// Phase 2B: raised from 10 now that facets make it easy to narrow a result
// set to well under one page; still small enough to keep pages fast.
const PAGE_SIZE = 25;

export type DbEnv = {
  DB: D1Database;
};

type EntryRow = {
  id: string;
  title: string;
  resource_type: string;
  therapy_modality: string;
  source_org: string | null;
  canonical_url: string;
  author: string | null;
  published_date: string | null;
  credibility_tier: number;
  is_link_only: number;
  citation_count: number | null;
  oa_status: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  link_status: LinkStatus;
  link_checked_at: string | null;
  updated_at: string | null;
  audience: AudienceValue;
  authors_json: string | null;
};

/** A parse failure here means the exporter's own preflight (which already
 * validates authors_json parses before it's ever written to D1 — see
 * validate_snapshot() in export_allodium_snapshot.py) was bypassed upstream.
 * Degrading to null rather than 500ing the entry page is the safer failure
 * mode for a non-essential citation-metadata field. */
function parseAuthorsJson(raw: string | null): AuthorRecord[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuthorRecord[]) : null;
  } catch {
    return null;
  }
}

type TagRow = { name: string; category: string };
type VerificationRow = {
  check_kind: CheckKind;
  result: string;
  method: string;
  method_version: string | null;
  score: number | null;
  checked_at: string | null;
};

function mapEntry(
  row: EntryRow,
  tags: TagRow[],
  verifications: VerificationRow[],
): PublicEntry {
  const entry: PublicEntry = {
    id: row.id,
    title: row.title,
    resource_type: row.resource_type,
    therapy_modality: row.therapy_modality,
    source_org: row.source_org,
    canonical_url: row.canonical_url,
    author: row.author,
    published_date: row.published_date,
    credibility_tier: row.credibility_tier,
    is_link_only: row.is_link_only === 1,
    citation_count: row.citation_count,
    oa_status: row.oa_status,
    doi: row.doi,
    pmid: row.pmid,
    pmcid: row.pmcid,
    link_status: row.link_status,
    link_checked_at: row.link_checked_at,
    updated_at: row.updated_at,
    audience: row.audience,
    authors: parseAuthorsJson(row.authors_json),
    tags,
    verifications,
  };
  assertNoForbiddenKeys(entry as unknown as Record<string, unknown>);
  return entry;
}

export async function getManifest(db: D1Database): Promise<SnapshotManifest | null> {
  const row = await db
    .prepare(
      `SELECT contract_version, schema_version, collection, source_generated_at,
              entry_count, tag_link_count, alias_count, checksum,
              abstract_search_enabled, exclusion_counts_json, coverage_json
       FROM snapshot_manifest WHERE id = 1`,
    )
    .first<{
      contract_version: string;
      schema_version: string;
      collection: string;
      source_generated_at: string;
      entry_count: number;
      tag_link_count: number;
      alias_count: number;
      checksum: string;
      abstract_search_enabled: number;
      exclusion_counts_json: string;
      coverage_json: string;
    }>();

  if (!row) return null;
  return {
    ...row,
    abstract_search_enabled: row.abstract_search_enabled === 1,
    coverage_json: JSON.parse(row.coverage_json) as CoverageStats,
  };
}

export async function resolveCanonicalId(
  db: D1Database,
  id: string,
): Promise<{ kind: "canonical" | "alias" | "missing"; canonicalId: string | null }> {
  const entry = await db
    .prepare(`SELECT id FROM entries WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (entry) return { kind: "canonical", canonicalId: entry.id };

  const alias = await db
    .prepare(`SELECT canonical_id FROM entry_aliases WHERE alias_id = ?`)
    .bind(id)
    .first<{ canonical_id: string }>();
  if (alias) return { kind: "alias", canonicalId: alias.canonical_id };

  return { kind: "missing", canonicalId: null };
}

export async function getEntry(db: D1Database, id: string): Promise<PublicEntry | null> {
  const row = await db
    .prepare(
      `SELECT id, title, resource_type, therapy_modality, source_org, canonical_url,
              author, published_date, credibility_tier, is_link_only, citation_count,
              oa_status, doi, pmid, pmcid, link_status, link_checked_at, updated_at,
              audience, authors_json
       FROM entries WHERE id = ?`,
    )
    .bind(id)
    .first<EntryRow>();
  if (!row) return null;

  const tags = (
    await db
      .prepare(
        `SELECT t.name, t.category
         FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
         WHERE et.entry_id = ?
         ORDER BY t.category, t.name`,
      )
      .bind(id)
      .all<TagRow>()
  ).results;

  const verifications = (
    await db
      .prepare(
        `SELECT check_kind, result, method, method_version, score, checked_at
         FROM entry_verifications
         WHERE entry_id = ?
         ORDER BY check_kind, checked_at`,
      )
      .bind(id)
      .all<VerificationRow>()
  ).results;

  return mapEntry(row, tags, verifications);
}

/** Phase 2C: precomputed cosine-kNN neighbors for the related-entries block,
 * joined against `entries` for the public-safe fields the view needs. A
 * plain INNER JOIN is what makes the "honest empty state when coverage is
 * missing" behavior automatic: an entry with no embedding at snapshot-build
 * time simply has zero `entry_neighbors` rows, so this returns `[]` rather
 * than needing a special case. */
export async function getRelatedEntries(
  db: D1Database,
  entryId: string,
): Promise<RelatedEntry[]> {
  return (
    await db
      .prepare(
        `SELECT e.id, e.title, e.therapy_modality, e.link_status
         FROM entry_neighbors n
         JOIN entries e ON e.id = n.neighbor_id
         WHERE n.entry_id = ?
         ORDER BY n.rank ASC`,
      )
      .bind(entryId)
      .all<RelatedEntry>()
  ).results;
}

const SHORTLIST_MAX_IDS = 50;

/** Phase 2D: pure parsing/validation for the `?ids=` query param on
 * `/psychotherapy/list` — a single comma-separated list is the entire
 * shareable state, so this never touches the database. Dedupes (keeping
 * first occurrence, since list order is meaningful to the reader) and caps
 * at `SHORTLIST_MAX_IDS` so an oversized URL can't turn into an oversized
 * query. */
export function parseShortlistIds(raw: string | null, cap = SHORTLIST_MAX_IDS): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= cap) break;
  }
  return ids;
}

export type ShortlistResult = {
  entries: PublicEntry[];
  missingIds: string[];
};

/** Phase 2D: batched multi-id fetch for the shortlist page — a handful of
 * `IN (...)` queries regardless of list size, rather than looping
 * `getEntry()` per id. Aliases resolve transparently against the same
 * `entry_aliases` table `resolveCanonicalId` uses, and any requested id that
 * resolves to nothing at all lands in `missingIds` so the view can render an
 * honest "N of M items could not be shown" note instead of a 500 or a
 * silently-shrunk list. */
export async function getEntriesByIds(
  db: D1Database,
  ids: string[],
): Promise<ShortlistResult> {
  if (ids.length === 0) return { entries: [], missingIds: [] };

  const placeholders = ids.map(() => "?").join(", ");
  const directHits = (
    await db
      .prepare(`SELECT id FROM entries WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: string }>()
  ).results;
  const directIds = new Set(directHits.map((r) => r.id));

  const aliasCandidates = ids.filter((id) => !directIds.has(id));
  const resolvedFromAlias = new Map<string, string>();
  if (aliasCandidates.length > 0) {
    const aliasPlaceholders = aliasCandidates.map(() => "?").join(", ");
    const aliasRows = (
      await db
        .prepare(
          `SELECT alias_id, canonical_id FROM entry_aliases WHERE alias_id IN (${aliasPlaceholders})`,
        )
        .bind(...aliasCandidates)
        .all<{ alias_id: string; canonical_id: string }>()
    ).results;
    for (const row of aliasRows) {
      resolvedFromAlias.set(row.alias_id, row.canonical_id);
    }
  }

  const canonicalFor = new Map<string, string>();
  for (const id of ids) {
    if (directIds.has(id)) canonicalFor.set(id, id);
    else if (resolvedFromAlias.has(id)) canonicalFor.set(id, resolvedFromAlias.get(id) as string);
  }
  const missingIds = ids.filter((id) => !canonicalFor.has(id));

  // Two requested ids (e.g. a canonical id and its retired alias) can
  // resolve to the same entry — dedupe by canonical id, keeping the order
  // the reader's list first requested them in.
  const canonicalIds: string[] = [];
  const canonicalSeen = new Set<string>();
  for (const id of ids) {
    const canonicalId = canonicalFor.get(id);
    if (!canonicalId || canonicalSeen.has(canonicalId)) continue;
    canonicalSeen.add(canonicalId);
    canonicalIds.push(canonicalId);
  }
  if (canonicalIds.length === 0) return { entries: [], missingIds };

  const entryPlaceholders = canonicalIds.map(() => "?").join(", ");
  const rows = (
    await db
      .prepare(
        `SELECT id, title, resource_type, therapy_modality, source_org, canonical_url,
                author, published_date, credibility_tier, is_link_only, citation_count,
                oa_status, doi, pmid, pmcid, link_status, link_checked_at, updated_at,
                audience, authors_json
         FROM entries WHERE id IN (${entryPlaceholders})`,
      )
      .bind(...canonicalIds)
      .all<EntryRow>()
  ).results;
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const tagRows = (
    await db
      .prepare(
        `SELECT et.entry_id AS entry_id, t.name, t.category
         FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
         WHERE et.entry_id IN (${entryPlaceholders})
         ORDER BY et.entry_id, t.category, t.name`,
      )
      .bind(...canonicalIds)
      .all<TagRow & { entry_id: string }>()
  ).results;
  const tagsByEntry = new Map<string, TagRow[]>();
  for (const row of tagRows) {
    const list = tagsByEntry.get(row.entry_id) ?? [];
    list.push({ name: row.name, category: row.category });
    tagsByEntry.set(row.entry_id, list);
  }

  const verificationRows = (
    await db
      .prepare(
        `SELECT entry_id, check_kind, result, method, method_version, score, checked_at
         FROM entry_verifications
         WHERE entry_id IN (${entryPlaceholders})
         ORDER BY entry_id, check_kind, checked_at`,
      )
      .bind(...canonicalIds)
      .all<VerificationRow & { entry_id: string }>()
  ).results;
  const verificationsByEntry = new Map<string, VerificationRow[]>();
  for (const row of verificationRows) {
    const list = verificationsByEntry.get(row.entry_id) ?? [];
    list.push({
      check_kind: row.check_kind,
      result: row.result,
      method: row.method,
      method_version: row.method_version,
      score: row.score,
      checked_at: row.checked_at,
    });
    verificationsByEntry.set(row.entry_id, list);
  }

  const entries = canonicalIds
    .map((id) => rowById.get(id))
    .filter((row): row is EntryRow => row !== undefined)
    .map((row) =>
      mapEntry(row, tagsByEntry.get(row.id) ?? [], verificationsByEntry.get(row.id) ?? []),
    );

  return { entries, missingIds };
}

/** Phase 1F: minimal row shape for /sitemap.xml — never selects public-safe
 * fields beyond what's already on the contract, since this is still a
 * public surface. */
export async function listEntriesForSitemap(
  db: D1Database,
): Promise<Array<{ id: string; updated_at: string | null }>> {
  return (
    await db.prepare(`SELECT id, updated_at FROM entries ORDER BY id`).all<{
      id: string;
      updated_at: string | null;
    }>()
  ).results;
}

/** Escape user query for FTS5 MATCH. Returns null if nothing searchable remains. */
export function sanitizeFtsQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  // Prefix match each token; quote to avoid FTS operators.
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

export function sanitizeLikeNeedle(raw: string): string | null {
  const cleaned = raw.replace(/[%_]/g, " ").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2) return null;
  return `%${cleaned.toLowerCase()}%`;
}

async function ftsAvailable(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'entry_fts'`,
      )
      .first<{ ok: number }>();
    return Boolean(row);
  } catch {
    return false;
  }
}

type SqlFragment = { sql: string; binds: unknown[] };

/** Splices an optional facet WHERE fragment onto a base condition. Both
 * sides are assumed non-empty SQL predicates (no leading AND/WHERE). */
function andFragments(...parts: Array<SqlFragment | null>): SqlFragment {
  const active = parts.filter((p): p is SqlFragment => p !== null && p.sql.length > 0);
  return {
    sql: active.map((p) => p.sql).join(" AND "),
    binds: active.flatMap((p) => p.binds),
  };
}

async function searchViaFts(
  db: D1Database,
  matchQuery: string,
  facetWhere: SqlFragment,
  limit: number,
  offset: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const where = andFragments({ sql: "entry_fts MATCH ?", binds: [matchQuery] }, facetWhere);

  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM entry_fts
       JOIN entries e ON e.id = entry_fts.entry_id
       WHERE ${where.sql}`,
    )
    .bind(...where.binds)
    .first<{ c: number }>();

  const rows = (
    await db
      .prepare(
        `SELECT e.id, e.title, e.resource_type, e.therapy_modality, e.source_org,
                e.link_status, bm25(entry_fts) AS score
         FROM entry_fts
         JOIN entries e ON e.id = entry_fts.entry_id
         WHERE ${where.sql}
         ORDER BY score ASC, e.title ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...where.binds, limit, offset)
      .all<{
        id: string;
        title: string;
        resource_type: string;
        therapy_modality: string;
        source_org: string | null;
        link_status: LinkStatus;
        score: number;
      }>()
  ).results;

  return {
    total: totalRow?.c ?? 0,
    hits: rows.map((r) => ({
      id: r.id,
      title: r.title,
      resource_type: r.resource_type,
      therapy_modality: r.therapy_modality,
      source_org: r.source_org,
      link_status: r.link_status,
      score: r.score,
    })),
  };
}

async function searchViaLike(
  db: D1Database,
  needle: string,
  facetWhere: SqlFragment,
  limit: number,
  offset: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  // LIKE fallback searches title + meta only — never abstract_text.
  const where = andFragments(
    { sql: "(lower(d.title) LIKE ? OR lower(d.meta) LIKE ?)", binds: [needle, needle] },
    facetWhere,
  );

  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM entry_search_documents d
       JOIN entries e ON e.id = d.entry_id
       WHERE ${where.sql}`,
    )
    .bind(...where.binds)
    .first<{ c: number }>();

  const rows = (
    await db
      .prepare(
        `SELECT e.id, e.title, e.resource_type, e.therapy_modality, e.source_org,
                e.link_status
         FROM entry_search_documents d
         JOIN entries e ON e.id = d.entry_id
         WHERE ${where.sql}
         ORDER BY e.title ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...where.binds, limit, offset)
      .all<{
        id: string;
        title: string;
        resource_type: string;
        therapy_modality: string;
        source_org: string | null;
        link_status: LinkStatus;
      }>()
  ).results;

  return {
    total: totalRow?.c ?? 0,
    hits: rows.map((r) => ({
      id: r.id,
      title: r.title,
      resource_type: r.resource_type,
      therapy_modality: r.therapy_modality,
      source_org: r.source_org,
      link_status: r.link_status,
      score: null,
    })),
  };
}

/** Phase 2B: browsing with filters but no text query — first-class, not a
 * fallback. Orders by title like the LIKE path since there's no bm25 score
 * to rank by. */
async function browseViaFacets(
  db: D1Database,
  facetWhere: SqlFragment,
  limit: number,
  offset: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const whereSql = facetWhere.sql ? `WHERE ${facetWhere.sql}` : "";

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM entries e ${whereSql}`)
    .bind(...facetWhere.binds)
    .first<{ c: number }>();

  const rows = (
    await db
      .prepare(
        `SELECT e.id, e.title, e.resource_type, e.therapy_modality, e.source_org,
                e.link_status
         FROM entries e
         ${whereSql}
         ORDER BY e.title ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...facetWhere.binds, limit, offset)
      .all<{
        id: string;
        title: string;
        resource_type: string;
        therapy_modality: string;
        source_org: string | null;
        link_status: LinkStatus;
      }>()
  ).results;

  return {
    total: totalRow?.c ?? 0,
    hits: rows.map((r) => ({
      id: r.id,
      title: r.title,
      resource_type: r.resource_type,
      therapy_modality: r.therapy_modality,
      source_org: r.source_org,
      link_status: r.link_status,
      score: null,
    })),
  };
}

export type SearchResult = {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  mode: "fts" | "like" | "browse" | "empty";
  query: string;
  filters: FacetFilters;
  facets: FacetCounts;
};

export async function searchEntries(
  db: D1Database,
  rawQuery: string,
  page = 1,
  filters: FacetFilters = EMPTY_FACET_FILTERS,
  options?: { forceLike?: boolean },
): Promise<SearchResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * PAGE_SIZE;
  const trimmed = rawQuery.trim();
  const filtered = hasActiveFilters(filters);

  // Facet counts are computed against the current filters (ignoring any
  // rejected/too-short search term) even on the "empty" path, so the
  // checkbox menu is populated on first landing — browsing must be
  // discoverable, not something only reachable by already knowing the URL
  // params.
  const empty = async (): Promise<SearchResult> => ({
    hits: [],
    total: 0,
    page: safePage,
    pageSize: PAGE_SIZE,
    mode: "empty",
    query: trimmed,
    filters,
    facets: await computeFacetCounts(db, filters, null),
  });

  if (!trimmed && !filtered) {
    return empty();
  }

  if (!trimmed) {
    // Phase 2B: browse-with-no-query is a first-class path once a filter is
    // active, not an error state.
    const facetWhere = buildFacetWhere(filters);
    const result = await browseViaFacets(db, facetWhere, PAGE_SIZE, offset);
    const facets = await computeFacetCounts(db, filters, null);
    return {
      ...result,
      page: safePage,
      pageSize: PAGE_SIZE,
      mode: "browse",
      query: trimmed,
      filters,
      facets,
    };
  }

  const useLike = options?.forceLike || !(await ftsAvailable(db));
  if (!useLike) {
    const matchQuery = sanitizeFtsQuery(trimmed);
    if (!matchQuery) return empty();
    try {
      const facetWhere = buildFacetWhere(filters);
      const result = await searchViaFts(db, matchQuery, facetWhere, PAGE_SIZE, offset);
      const searchClause: SqlFragment = {
        sql: "e.id IN (SELECT entry_id FROM entry_fts WHERE entry_fts MATCH ?)",
        binds: [matchQuery],
      };
      const facets = await computeFacetCounts(db, filters, searchClause);
      return { ...result, page: safePage, pageSize: PAGE_SIZE, mode: "fts", query: trimmed, filters, facets };
    } catch {
      // Fall through to LIKE on FTS errors (corrupt vtab, syntax, etc.)
    }
  }

  const needle = sanitizeLikeNeedle(trimmed);
  if (!needle) return empty();
  const facetWhere = buildFacetWhere(filters);
  const result = await searchViaLike(db, needle, facetWhere, PAGE_SIZE, offset);
  const searchClause: SqlFragment = {
    sql: "e.id IN (SELECT entry_id FROM entry_search_documents WHERE lower(title) LIKE ? OR lower(meta) LIKE ?)",
    binds: [needle, needle],
  };
  const facets = await computeFacetCounts(db, filters, searchClause);
  return { ...result, page: safePage, pageSize: PAGE_SIZE, mode: "like", query: trimmed, filters, facets };
}

export { PAGE_SIZE };
