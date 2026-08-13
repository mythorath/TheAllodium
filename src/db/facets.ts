import { AUDIENCE_VALUES, LINK_STATUSES } from "../contract";
import type { AudienceValue, LinkStatus } from "../contract";

export type AccessValue = "free" | "paywalled";
export type StorageValue = "stored" | "link_only";

/** Phase 2.5A: exclusive corpus split. `literature` is papers;
 * `materials` is everything else. Not derived from credibility_tier. */
export const KIND_VALUES = ["literature", "materials"] as const;
export type KindValue = (typeof KIND_VALUES)[number];

export const KIND_LABELS: Record<KindValue, string> = {
  literature: "Literature",
  materials: "Materials",
};

/** Phase 2.5B: literature-only decade buckets over `published_date`. */
export const DECADE_VALUES = ["2020s", "2010s", "2000s", "pre-2000"] as const;
export type DecadeValue = (typeof DECADE_VALUES)[number];

export type FacetFilters = {
  kind: KindValue | null;
  modality: string[];
  audience: AudienceValue[];
  access: AccessValue[];
  storage: StorageValue[];
  linkStatus: LinkStatus[];
  topic: string[];
  hexaflex: string[];
  type: string[];
  decade: DecadeValue[];
};

export type FacetDimension = keyof FacetFilters;

export const EMPTY_FACET_FILTERS: FacetFilters = {
  kind: null,
  modality: [],
  audience: [],
  access: [],
  storage: [],
  linkStatus: [],
  topic: [],
  hexaflex: [],
  type: [],
  decade: [],
};

export function hasActiveFilters(filters: FacetFilters): boolean {
  return (
    filters.kind !== null ||
    filters.modality.length > 0 ||
    filters.audience.length > 0 ||
    filters.access.length > 0 ||
    filters.storage.length > 0 ||
    filters.linkStatus.length > 0 ||
    filters.topic.length > 0 ||
    filters.hexaflex.length > 0 ||
    filters.type.length > 0 ||
    filters.decade.length > 0
  );
}

const MAX_VALUES_PER_DIMENSION = 25;
const MAX_MODALITY_LENGTH = 100;

export const AUDIENCE_SET = new Set<string>(AUDIENCE_VALUES);
const LINK_STATUS_SET = new Set<string>(LINK_STATUSES);
const ACCESS_SET = new Set<string>(["free", "paywalled"]);
const STORAGE_SET = new Set<string>(["stored", "link_only"]);
const KIND_SET = new Set<string>(KIND_VALUES);
export const DECADE_SET = new Set<string>(DECADE_VALUES);

/** Dedupes, trims, drops empties, enforces an allowlist (when given) and a
 * count cap so a crafted URL with thousands of repeated params can't blow up
 * query size. `modality` has no allowlist (free text from the corpus) but
 * still gets a length cap. */
function sanitizeValues<T extends string>(
  raw: string[] | undefined,
  allowed: Set<string> | null,
  maxLength = 64,
): T[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of raw) {
    const trimmed = v.trim().slice(0, maxLength);
    if (!trimmed || seen.has(trimmed)) continue;
    if (allowed && !allowed.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed as T);
    if (out.length >= MAX_VALUES_PER_DIMENSION) break;
  }
  return out;
}

/** Exclusive corpus selector: first allowlisted `?kind=` value wins;
 * unknown/empty values are dropped so `kind=` (the "All" radio) is null. */
export function parseKind(raw: string[] | undefined): KindValue | null {
  if (!raw) return null;
  for (const v of raw) {
    const trimmed = v.trim().toLowerCase();
    if (KIND_SET.has(trimmed)) return trimmed as KindValue;
  }
  return null;
}

/** Reads every facet dimension from query params, e.g.
 * `?kind=literature&topic=depression&decade=2010s`. `getAll` is expected
 * to be Hono's `c.req.queries(name)`, which returns `undefined` when the
 * param is absent. */
export function parseFacetFilters(getAll: (name: string) => string[] | undefined): FacetFilters {
  return {
    kind: parseKind(getAll("kind")),
    modality: sanitizeValues(getAll("modality"), null, MAX_MODALITY_LENGTH),
    audience: sanitizeValues<AudienceValue>(getAll("audience"), AUDIENCE_SET),
    access: sanitizeValues<AccessValue>(getAll("access"), ACCESS_SET),
    storage: sanitizeValues<StorageValue>(getAll("storage"), STORAGE_SET),
    linkStatus: sanitizeValues<LinkStatus>(getAll("link_status"), LINK_STATUS_SET),
    topic: sanitizeValues(getAll("topic"), null),
    hexaflex: sanitizeValues(getAll("hexaflex"), null),
    type: sanitizeValues(getAll("type"), null),
    decade: sanitizeValues<DecadeValue>(getAll("decade"), DECADE_SET),
  };
}

type SqlFragment = { sql: string; binds: unknown[] };

function inClause(column: string, values: string[]): SqlFragment | null {
  if (values.length === 0) return null;
  return { sql: `${column} IN (${values.map(() => "?").join(", ")})`, binds: [...values] };
}

function accessClause(values: AccessValue[]): SqlFragment | null {
  if (values.length === 0) return null;
  const parts: string[] = [];
  if (values.includes("free")) parts.push(`(e.oa_status IS NOT NULL AND e.oa_status != 'closed')`);
  if (values.includes("paywalled")) parts.push(`e.oa_status = 'closed'`);
  return { sql: `(${parts.join(" OR ")})`, binds: [] };
}

function storageClause(values: StorageValue[]): SqlFragment | null {
  if (values.length === 0) return null;
  const parts: string[] = [];
  if (values.includes("stored")) parts.push(`e.is_link_only = 0`);
  if (values.includes("link_only")) parts.push(`e.is_link_only = 1`);
  return { sql: `(${parts.join(" OR ")})`, binds: [] };
}

function kindClause(kind: KindValue | null): SqlFragment | null {
  if (kind === "literature") return { sql: "e.resource_type = 'paper'", binds: [] };
  if (kind === "materials") return { sql: "e.resource_type != 'paper'", binds: [] };
  return null;
}

function tagExistsClause(category: "topic" | "hexaflex", names: string[]): SqlFragment | null {
  if (names.length === 0) return null;
  const placeholders = names.map(() => "?").join(", ");
  return {
    sql: `EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.category = ? AND t.name IN (${placeholders}))`,
    binds: [category, ...names],
  };
}

function decadeRangeSql(value: DecadeValue): string {
  switch (value) {
    case "2020s":
      return "e.published_date >= '2020' AND e.published_date < '2030'";
    case "2010s":
      return "e.published_date >= '2010' AND e.published_date < '2020'";
    case "2000s":
      return "e.published_date >= '2000' AND e.published_date < '2010'";
    case "pre-2000":
      return "e.published_date IS NOT NULL AND e.published_date < '2000'";
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

function decadeClause(values: DecadeValue[]): SqlFragment | null {
  if (values.length === 0) return null;
  return {
    sql: `(${values.map((v) => `(${decadeRangeSql(v)})`).join(" OR ")})`,
    binds: [],
  };
}

const DECADE_SELECT_EXPR = `CASE WHEN e.published_date >= '2020' AND e.published_date < '2030' THEN '2020s' WHEN e.published_date >= '2010' AND e.published_date < '2020' THEN '2010s' WHEN e.published_date >= '2000' AND e.published_date < '2010' THEN '2000s' WHEN e.published_date IS NOT NULL AND e.published_date < '2000' THEN 'pre-2000' END`;

/**
 * ANDs together one condition per non-empty facet dimension (all assumed to
 * reference the `entries e` alias). `excludeDimension` leaves that one
 * dimension's own filter out — used when computing that dimension's own
 * cross-filtered counts, so a facet never filters itself out of its own
 * count query. Returns an empty clause (no leading AND/WHERE) when nothing
 * is active.
 */
export function buildFacetWhere(
  filters: FacetFilters,
  excludeDimension?: FacetDimension,
): SqlFragment {
  const fragments = [
    excludeDimension === "kind" ? null : kindClause(filters.kind),
    excludeDimension === "modality" ? null : inClause("e.therapy_modality", filters.modality),
    excludeDimension === "audience" ? null : inClause("e.audience", filters.audience),
    excludeDimension === "access" ? null : accessClause(filters.access),
    excludeDimension === "storage" ? null : storageClause(filters.storage),
    excludeDimension === "linkStatus" ? null : inClause("e.link_status", filters.linkStatus),
    excludeDimension === "topic" ? null : tagExistsClause("topic", filters.topic),
    excludeDimension === "hexaflex" ? null : tagExistsClause("hexaflex", filters.hexaflex),
    excludeDimension === "type" ? null : inClause("e.resource_type", filters.type),
    excludeDimension === "decade" ? null : decadeClause(filters.decade),
  ].filter((f): f is SqlFragment => f !== null);

  if (fragments.length === 0) return { sql: "", binds: [] };
  return {
    sql: fragments.map((f) => f.sql).join(" AND "),
    binds: fragments.flatMap((f) => f.binds),
  };
}

export type FacetOption = { value: string; count: number; selected: boolean };
export type FacetCounts = {
  kind: FacetOption[];
  modality: FacetOption[];
  audience: FacetOption[];
  access: FacetOption[];
  storage: FacetOption[];
  linkStatus: FacetOption[];
  topic: FacetOption[];
  hexaflex: FacetOption[];
  type: FacetOption[];
  decade: FacetOption[];
};

type CountRow = { v: string; c: number };

async function runFacetCountQuery(
  db: D1Database,
  selectExpr: string,
  extraWhere: string | null,
  filters: FacetFilters,
  excludeDimension: FacetDimension,
  searchClause: SqlFragment | null,
): Promise<CountRow[]> {
  const otherFilters = buildFacetWhere(filters, excludeDimension);
  const whereParts: string[] = [];
  const binds: unknown[] = [];
  if (searchClause) {
    whereParts.push(searchClause.sql);
    binds.push(...searchClause.binds);
  }
  if (extraWhere) whereParts.push(extraWhere);
  if (otherFilters.sql) {
    whereParts.push(otherFilters.sql);
    binds.push(...otherFilters.binds);
  }
  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  const sql = `SELECT ${selectExpr} AS v, COUNT(*) AS c FROM entries e ${whereSql} GROUP BY v ORDER BY v`;
  return (await db.prepare(sql).bind(...binds).all<CountRow>()).results;
}

async function runTagCountQuery(
  db: D1Database,
  category: "topic" | "hexaflex",
  filters: FacetFilters,
  excludeDimension: FacetDimension,
  searchClause: SqlFragment | null,
): Promise<CountRow[]> {
  const otherFilters = buildFacetWhere(filters, excludeDimension);
  const whereParts: string[] = ["t.category = ?"];
  const binds: unknown[] = [category];
  if (searchClause) {
    whereParts.push(searchClause.sql);
    binds.push(...searchClause.binds);
  }
  if (otherFilters.sql) {
    whereParts.push(otherFilters.sql);
    binds.push(...otherFilters.binds);
  }
  const sql = `SELECT t.name AS v, COUNT(*) AS c FROM entries e JOIN entry_tags et ON et.entry_id = e.id JOIN tags t ON t.id = et.tag_id WHERE ${whereParts.join(" AND ")} GROUP BY t.name ORDER BY t.name`;
  return (await db.prepare(sql).bind(...binds).all<CountRow>()).results;
}

function toOptions(rows: CountRow[], selected: string[]): FacetOption[] {
  const selectedSet = new Set(selected);
  return rows
    .filter((r) => r.v != null && r.v !== "")
    .map((r) => ({ value: r.v, count: r.c, selected: selectedSet.has(r.v) }));
}

/**
 * Computes cross-filtered facet value counts: each dimension's counts
 * reflect the text-search match (if any) plus every *other* active
 * dimension's filter, but never that dimension's own filter — so a user can
 * see which values would still return results if added to (not replacing)
 * the current selection. Zero-count values simply don't appear (GROUP BY
 * naturally excludes them), matching how most faceted search UIs hide dead
 * ends rather than showing greyed-out zeros.
 */
export async function computeFacetCounts(
  db: D1Database,
  filters: FacetFilters,
  searchClause: SqlFragment | null,
): Promise<FacetCounts> {
  const [
    kindRows,
    modalityRows,
    audienceRows,
    accessRows,
    storageRows,
    linkStatusRows,
    topicRows,
    hexaflexRows,
    typeRows,
    decadeRows,
  ] = await Promise.all([
    runFacetCountQuery(
      db,
      "CASE WHEN e.resource_type = 'paper' THEN 'literature' ELSE 'materials' END",
      null,
      filters,
      "kind",
      searchClause,
    ),
    runFacetCountQuery(db, "e.therapy_modality", null, filters, "modality", searchClause),
    runFacetCountQuery(db, "e.audience", null, filters, "audience", searchClause),
    runFacetCountQuery(
      db,
      "CASE WHEN e.oa_status = 'closed' THEN 'paywalled' ELSE 'free' END",
      "e.oa_status IS NOT NULL",
      filters,
      "access",
      searchClause,
    ),
    runFacetCountQuery(
      db,
      "CASE WHEN e.is_link_only = 1 THEN 'link_only' ELSE 'stored' END",
      null,
      filters,
      "storage",
      searchClause,
    ),
    runFacetCountQuery(db, "e.link_status", null, filters, "linkStatus", searchClause),
    runTagCountQuery(db, "topic", filters, "topic", searchClause),
    runTagCountQuery(db, "hexaflex", filters, "hexaflex", searchClause),
    runFacetCountQuery(db, "e.resource_type", null, filters, "type", searchClause),
    runFacetCountQuery(
      db,
      DECADE_SELECT_EXPR,
      "e.published_date IS NOT NULL",
      filters,
      "decade",
      searchClause,
    ),
  ]);

  return {
    kind: toOptions(kindRows, filters.kind ? [filters.kind] : []),
    modality: toOptions(modalityRows, filters.modality),
    audience: toOptions(audienceRows, filters.audience),
    access: toOptions(accessRows, filters.access),
    storage: toOptions(storageRows, filters.storage),
    linkStatus: toOptions(linkStatusRows, filters.linkStatus),
    topic: toOptions(topicRows, filters.topic),
    hexaflex: toOptions(hexaflexRows, filters.hexaflex),
    type: toOptions(typeRows, filters.type),
    decade: toOptions(decadeRows, filters.decade),
  };
}
