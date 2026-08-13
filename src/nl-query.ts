import type { AudienceValue } from "./contract";
import type { DecadeValue, FacetFilters } from "./db/facets";
import {
  AUDIENCE_SET,
  DECADE_SET,
  EMPTY_FACET_FILTERS,
  hasActiveFilters,
  parseKind,
} from "./db/facets";
import type { NlAllowlists } from "./db/repository";

export const ASK_MAX_CHARS = 300;
const MAX_VALUES_PER_DIMENSION = 25;
const MAX_MODALITY_LENGTH = 100;

export type NormalizedNlQuery = {
  filters: FacetFilters;
  q: string;
};

function asStrings(raw: unknown): string[] {
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  return [];
}

function matchAllowlist(
  raw: unknown,
  allowed: Set<string>,
  maxLength = 64,
): string[] {
  const byLower = new Map<string, string>();
  for (const value of allowed) {
    byLower.set(value.toLowerCase(), value);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of asStrings(raw)) {
    const trimmed = value.trim().slice(0, maxLength);
    if (!trimmed) continue;
    const canonical = byLower.get(trimmed.toLowerCase());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= MAX_VALUES_PER_DIMENSION) break;
  }
  return out;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** GPU output is an untrusted suggestion. Map case-insensitively onto
 * canonical D1 / allowlist strings and drop everything else. */
export function normalizeNlFacets(
  raw: unknown,
  allowlists: NlAllowlists,
): NormalizedNlQuery | null {
  if (!isRecord(raw)) return null;

  const kind = parseKind(asStrings(raw.kind));
  const filters: FacetFilters = {
    ...EMPTY_FACET_FILTERS,
    kind,
    modality: matchAllowlist(raw.modality, allowlists.modality, MAX_MODALITY_LENGTH),
    topic: matchAllowlist(raw.topic, allowlists.topic),
    hexaflex: matchAllowlist(raw.hexaflex, allowlists.hexaflex),
    type: matchAllowlist(raw.type, allowlists.type),
    decade: matchAllowlist(raw.decade, DECADE_SET) as DecadeValue[],
    audience: matchAllowlist(raw.audience, AUDIENCE_SET) as AudienceValue[],
  };

  const qRaw = typeof raw.q === "string" ? raw.q : "";
  const q = qRaw.trim().slice(0, ASK_MAX_CHARS);

  if (!hasActiveFilters(filters) && !q) return null;
  return { filters, q };
}
