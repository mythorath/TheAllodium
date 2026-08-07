import type {
  CheckKind,
  LinkStatus,
  PublicEntry,
  SearchHit,
  SnapshotManifest,
} from "../contract";
import { assertNoForbiddenKeys } from "../contract";

const PAGE_SIZE = 10;

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
};

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
              abstract_search_enabled, exclusion_counts_json
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
    }>();

  if (!row) return null;
  return {
    ...row,
    abstract_search_enabled: row.abstract_search_enabled === 1,
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
              oa_status, doi, pmid, pmcid, link_status, link_checked_at, updated_at
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

async function searchViaFts(
  db: D1Database,
  matchQuery: string,
  limit: number,
  offset: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM entry_fts
       WHERE entry_fts MATCH ?`,
    )
    .bind(matchQuery)
    .first<{ c: number }>();

  const rows = (
    await db
      .prepare(
        `SELECT e.id, e.title, e.resource_type, e.therapy_modality, e.source_org,
                e.link_status, bm25(entry_fts) AS score
         FROM entry_fts
         JOIN entries e ON e.id = entry_fts.entry_id
         WHERE entry_fts MATCH ?
         ORDER BY score ASC, e.title ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(matchQuery, limit, offset)
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
  limit: number,
  offset: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  // LIKE fallback searches title + meta only — never abstract_text.
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM entry_search_documents d
       JOIN entries e ON e.id = d.entry_id
       WHERE lower(d.title) LIKE ? OR lower(d.meta) LIKE ?`,
    )
    .bind(needle, needle)
    .first<{ c: number }>();

  const rows = (
    await db
      .prepare(
        `SELECT e.id, e.title, e.resource_type, e.therapy_modality, e.source_org,
                e.link_status
         FROM entry_search_documents d
         JOIN entries e ON e.id = d.entry_id
         WHERE lower(d.title) LIKE ? OR lower(d.meta) LIKE ?
         ORDER BY e.title ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(needle, needle, limit, offset)
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
  mode: "fts" | "like" | "empty";
  query: string;
};

export async function searchEntries(
  db: D1Database,
  rawQuery: string,
  page = 1,
  options?: { forceLike?: boolean },
): Promise<SearchResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * PAGE_SIZE;
  const trimmed = rawQuery.trim();

  if (!trimmed) {
    return {
      hits: [],
      total: 0,
      page: safePage,
      pageSize: PAGE_SIZE,
      mode: "empty",
      query: trimmed,
    };
  }

  const useLike = options?.forceLike || !(await ftsAvailable(db));
  if (!useLike) {
    const matchQuery = sanitizeFtsQuery(trimmed);
    if (!matchQuery) {
      return {
        hits: [],
        total: 0,
        page: safePage,
        pageSize: PAGE_SIZE,
        mode: "empty",
        query: trimmed,
      };
    }
    try {
      const result = await searchViaFts(db, matchQuery, PAGE_SIZE, offset);
      return { ...result, page: safePage, pageSize: PAGE_SIZE, mode: "fts", query: trimmed };
    } catch {
      // Fall through to LIKE on FTS errors (corrupt vtab, syntax, etc.)
    }
  }

  const needle = sanitizeLikeNeedle(trimmed);
  if (!needle) {
    return {
      hits: [],
      total: 0,
      page: safePage,
      pageSize: PAGE_SIZE,
      mode: "empty",
      query: trimmed,
    };
  }
  const result = await searchViaLike(db, needle, PAGE_SIZE, offset);
  return { ...result, page: safePage, pageSize: PAGE_SIZE, mode: "like", query: trimmed };
}

export { PAGE_SIZE };
