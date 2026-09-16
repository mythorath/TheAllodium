import type { FacetFilters } from "./db/facets";
import { DEFAULT_SORT } from "./db/sort";
import type { SortOption } from "./db/sort";

const FACET_PARAM_NAMES = {
  kind: "kind",
  modality: "modality",
  audience: "audience",
  access: "access",
  storage: "storage",
  linkStatus: "link_status",
  topic: "topic",
  hexaflex: "hexaflex",
  type: "type",
  decade: "decade",
} as const;

export { FACET_PARAM_NAMES };

/** Every active filter, as `[paramName, value][]`: the single source both
 * the checkbox `checked` state and the URL-building helpers draw from. */
export function filterEntries(filters: FacetFilters): Array<[string, string]> {
  return [
    ...(filters.kind ? [[FACET_PARAM_NAMES.kind, filters.kind] as [string, string]] : []),
    ...filters.modality.map((v): [string, string] => [FACET_PARAM_NAMES.modality, v]),
    ...filters.audience.map((v): [string, string] => [FACET_PARAM_NAMES.audience, v]),
    ...filters.access.map((v): [string, string] => [FACET_PARAM_NAMES.access, v]),
    ...filters.storage.map((v): [string, string] => [FACET_PARAM_NAMES.storage, v]),
    ...filters.linkStatus.map((v): [string, string] => [FACET_PARAM_NAMES.linkStatus, v]),
    ...filters.topic.map((v): [string, string] => [FACET_PARAM_NAMES.topic, v]),
    ...filters.hexaflex.map((v): [string, string] => [FACET_PARAM_NAMES.hexaflex, v]),
    ...filters.type.map((v): [string, string] => [FACET_PARAM_NAMES.type, v]),
    ...filters.decade.map((v): [string, string] => [FACET_PARAM_NAMES.decade, v]),
  ];
}

export function buildSearchHref(
  query: string,
  filters: FacetFilters,
  page?: number,
  sort: SortOption = DEFAULT_SORT,
  likeId?: string | null,
): string {
  const parts: string[] = [];
  if (query) parts.push(`q=${encodeURIComponent(query)}`);
  else if (likeId) parts.push(`like=${encodeURIComponent(likeId)}`);
  for (const [name, value] of filterEntries(filters)) {
    parts.push(`${name}=${encodeURIComponent(value)}`);
  }
  if (sort !== DEFAULT_SORT) parts.push(`sort=${encodeURIComponent(sort)}`);
  if (page && page > 1) parts.push(`page=${page}`);
  return `/psychotherapy/search${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}

export function withSearchFlag(
  href: string,
  name: "crisis" | "assist",
  value: string,
): string {
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}${name}=${encodeURIComponent(value)}`;
}
