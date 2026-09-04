import type {
  FederationSource,
  NormalizedWork,
  SourceEvidence,
  WorkAuthor,
} from "./types";

const SOURCE_PRECEDENCE: Readonly<Record<FederationSource, number>> = {
  pubmed: 0,
  "europe-pmc": 1,
  crossref: 2,
  datacite: 3,
  doaj: 4,
  zenodo: 5,
  hal: 6,
  arxiv: 7,
  doab: 8,
  dblp: 9,
};

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  let normalized = value.trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // A malformed percent escape is still safe to normalize as plain text.
  }
  normalized = normalized
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim()
    .replace(/[)\]}>.,;:]+$/g, "")
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : null;
}

export function arxivSyntheticDoi(
  arxivId: string | null | undefined,
): string | null {
  if (!arxivId) return null;
  const normalized = arxivId
    .trim()
    .replace(/^arxiv:\s*/i, "")
    .replace(/v\d+$/i, "");
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})$/i.test(normalized)) {
    return null;
  }
  return `10.48550/arxiv.${normalized.toLowerCase()}`;
}

function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function authorSurname(author: WorkAuthor | string | null | undefined): string {
  if (!author) return "";
  if (typeof author !== "string") {
    if (author.familyName) return normalizeIdentityText(author.familyName);
    return authorSurname(author.name);
  }
  const clean = author.trim();
  if (!clean) return "";
  const comma = clean.indexOf(",");
  const candidate =
    comma >= 0 ? clean.slice(0, comma) : (clean.split(/\s+/).at(-1) ?? "");
  return normalizeIdentityText(candidate);
}

export function fallbackIdentityKey(
  title: string,
  firstAuthor: WorkAuthor | string | null | undefined,
  year: number | string | null | undefined,
): string | null {
  const normalizedTitle = normalizeIdentityText(title);
  const surname = authorSurname(firstAuthor);
  const normalizedYear =
    typeof year === "number"
      ? String(year)
      : String(year ?? "").match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? "";
  if (!normalizedTitle || !surname || !normalizedYear) return null;
  return `fallback:${normalizedTitle}|${surname}|${normalizedYear}`;
}

export function workIdentityKeys(work: NormalizedWork): readonly string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(work.doi) ?? arxivSyntheticDoi(work.arxivId);
  if (doi) keys.push(`doi:${doi}`);
  const fallback = fallbackIdentityKey(
    work.title,
    work.authors[0],
    work.publicationYear,
  );
  if (fallback) keys.push(fallback);
  return keys;
}

function evidencePriority(evidence: readonly SourceEvidence[]): number {
  return evidence.reduce(
    (best, item) => Math.min(best, SOURCE_PRECEDENCE[item.source]),
    Number.POSITIVE_INFINITY,
  );
}

function compareWorks(left: NormalizedWork, right: NormalizedWork): number {
  const bySource = evidencePriority(left.evidence) - evidencePriority(right.evidence);
  if (bySource !== 0) return bySource;
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function chooseString(
  preferred: NormalizedWork,
  secondary: NormalizedWork,
  field:
    | "title"
    | "publishedDate"
    | "doi"
    | "arxivId"
    | "pmid"
    | "pmcid"
    | "type"
    | "containerTitle"
    | "publisher"
    | "canonicalUrl",
): string | null {
  return preferred[field] || secondary[field] || null;
}

function mergeEvidence(
  left: readonly SourceEvidence[],
  right: readonly SourceEvidence[],
): readonly SourceEvidence[] {
  const unique = new Map<string, SourceEvidence>();
  for (const evidence of [...left, ...right]) {
    unique.set(`${evidence.source}:${evidence.sourceId}`, evidence);
  }
  return [...unique.values()].sort(
    (a, b) =>
      SOURCE_PRECEDENCE[a.source] - SOURCE_PRECEDENCE[b.source] ||
      a.sourceId.localeCompare(b.sourceId),
  );
}

export function mergeTwoWorks(
  left: NormalizedWork,
  right: NormalizedWork,
): NormalizedWork {
  const [preferred, secondary] =
    compareWorks(left, right) <= 0 ? [left, right] : [right, left];
  return {
    title: chooseString(preferred, secondary, "title") ?? "",
    authors:
      preferred.authors.length > 0 ? preferred.authors : secondary.authors,
    publicationYear:
      preferred.publicationYear ?? secondary.publicationYear ?? null,
    publishedDate: chooseString(preferred, secondary, "publishedDate"),
    doi: normalizeDoi(chooseString(preferred, secondary, "doi")),
    arxivId: chooseString(preferred, secondary, "arxivId"),
    pmid: chooseString(preferred, secondary, "pmid"),
    pmcid: chooseString(preferred, secondary, "pmcid"),
    type: chooseString(preferred, secondary, "type"),
    containerTitle: chooseString(preferred, secondary, "containerTitle"),
    publisher: chooseString(preferred, secondary, "publisher"),
    canonicalUrl: chooseString(preferred, secondary, "canonicalUrl"),
    isOpenAccess: preferred.isOpenAccess ?? secondary.isOpenAccess ?? null,
    evidence: mergeEvidence(left.evidence, right.evidence),
  };
}

export function dedupeAndMergeWorks(
  works: readonly NormalizedWork[],
): readonly NormalizedWork[] {
  const groups: NormalizedWork[] = [];
  for (const work of [...works].sort(compareWorks)) {
    const keys = new Set(workIdentityKeys(work));
    const matchingIndexes = groups.flatMap((group, index) =>
      workIdentityKeys(group).some((key) => keys.has(key)) ? [index] : [],
    );
    if (matchingIndexes.length === 0) {
      groups.push(work);
      continue;
    }
    const first = matchingIndexes[0];
    let merged = mergeTwoWorks(groups[first], work);
    for (const index of matchingIndexes.slice(1).reverse()) {
      merged = mergeTwoWorks(merged, groups[index]);
      groups.splice(index, 1);
    }
    groups[first] = merged;
  }
  return groups.sort((a, b) => {
    const leftKey = workIdentityKeys(a)[0] ?? JSON.stringify(a);
    const rightKey = workIdentityKeys(b)[0] ?? JSON.stringify(b);
    return leftKey.localeCompare(rightKey);
  });
}
