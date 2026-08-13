/** Allowlisted sort options for `/psychotherapy/search?sort=…`. */

export const SORT_OPTIONS = [
  "relevance",
  "date_desc",
  "date_asc",
  "title_asc",
  "citations_desc",
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

export const DEFAULT_SORT: SortOption = "relevance";

const SORT_SET = new Set<string>(SORT_OPTIONS);

/** Parse a `?sort=` query value; unknown/absent values fall back to relevance. */
export function parseSortOption(raw: string | undefined | null): SortOption {
  if (!raw) return DEFAULT_SORT;
  const trimmed = raw.trim().toLowerCase();
  if (SORT_SET.has(trimmed)) return trimmed as SortOption;
  return DEFAULT_SORT;
}

/**
 * ORDER BY fragment for the three search paths. `hasScore` is true only for
 * the FTS path (bm25 available as `score`); browse/LIKE fall back to title
 * when the caller asks for relevance.
 *
 * Date/citation sorts put NULLs last so undated / uncited entries don't
 * crowd the top of "newest" / "most cited" lists.
 *
 * Every branch ends in `e.id ASC` — the corpus has duplicate titles (and
 * could, in principle, have duplicate dates/citation counts), so without a
 * final tiebreaker on the one column guaranteed unique per row, SQLite/D1
 * is free to return tied rows in an implementation-defined order. Left
 * unfixed, that meant which entry landed at a given list position/page
 * could silently differ between two otherwise identical requests — the
 * root cause of entry links appearing to "change" over time. See
 * tests/link-integrity.test.ts for the regression test.
 */
export function sortOrderBy(sort: SortOption, hasScore: boolean): string {
  switch (sort) {
    case "relevance":
      return hasScore ? "score ASC, e.title ASC, e.id ASC" : "e.title ASC, e.id ASC";
    case "date_desc":
      return "e.published_date IS NULL, e.published_date DESC, e.title ASC, e.id ASC";
    case "date_asc":
      return "e.published_date IS NULL, e.published_date ASC, e.title ASC, e.id ASC";
    case "title_asc":
      return "e.title ASC, e.id ASC";
    case "citations_desc":
      return "e.citation_count IS NULL, e.citation_count DESC, e.title ASC, e.id ASC";
    default: {
      const _exhaustive: never = sort;
      return _exhaustive;
    }
  }
}

export const SORT_LABELS: Record<SortOption, string> = {
  relevance: "Relevance",
  date_desc: "Newest first",
  date_asc: "Oldest first",
  title_asc: "Title A–Z",
  citations_desc: "Most cited",
};
