import { getRetractionsByDoi, hasAuthorityFamily } from "../authority/repository";
import type { AuthorityLookup, AuthorityLookups, CredibilityResult } from "../credibility/types";
import { scoreCredibility } from "../credibility/score";
import { getCrossrefWorkByDoi, PUBLIC_FEDERATION_ADAPTERS } from "./adapters";
import {
  createSearchCache,
  federatedIdentifierCacheKey,
  federatedSearchCacheKey,
  IDENTIFIER_LOOKUP_TTL_SECONDS,
  type WaitUntilContext,
} from "./cache";
import { dedupeAndMergeWorks, normalizeDoi } from "./identity";
import { requestUpstreamPermit } from "./rate-limiter";
import type {
  AdapterResult,
  FederationAdapter,
  FederationQuery,
  FederationSource,
  NormalizedWork,
} from "./types";

export type FederationBindings = {
  AUTHORITY?: D1Database;
  SEARCH_CACHE?: KVNamespace;
  UPSTREAM_RATE_LIMITER?: DurableObjectNamespace;
  FEDERATION_CONTACT_EMAIL?: string;
};

export type ScoredFederatedWork = {
  work: NormalizedWork;
  credibility: CredibilityResult;
};

export type FederatedSearchResponse = {
  query: FederationQuery;
  works: ScoredFederatedWork[];
  adapters: AdapterResult[];
  partial: boolean;
  cached: boolean;
};

function sourceLookup(
  work: NormalizedWork,
  source: FederationSource,
  label: string,
  license: string,
): AuthorityLookup {
  const matched = work.evidence.some((item) => item.source === source);
  return {
    matched,
    evidence: matched
      ? `A matching record was returned by ${label}.`
      : `No matching ${label} record was present in this response.`,
    source: label,
    license,
  };
}

async function credibilityLookups(
  work: NormalizedWork,
  authority: D1Database | undefined,
): Promise<AuthorityLookups> {
  const crossref = sourceLookup(work, "crossref", "Crossref", "CC0 metadata");
  const lookups: AuthorityLookups = {
    doiRegistered: work.doi ? crossref : undefined,
    doiResolves: work.doi ? crossref : undefined,
    doaj: sourceLookup(work, "doaj", "DOAJ", "CC0"),
  };
  if (!authority || !work.doi) return lookups;

  try {
    // Querying an unloaded family would return zero rows for every DOI, which
    // would be published as "no retraction notice matched": reassurance drawn
    // from an empty table. Absent data has to stay unchecked instead.
    if (!(await hasAuthorityFamily(authority, "retraction_watch"))) return lookups;

    const notices = await getRetractionsByDoi(authority, work.doi);
    const lookupFor = (kind: RegExp, label: string): AuthorityLookup => {
      const matches = notices.filter((notice) => kind.test(notice.noticeType));
      return {
        matched: matches.length > 0,
        evidence:
          matches.length > 0
            ? `${matches.length} ${label} notice${matches.length === 1 ? "" : "s"} matched this DOI.`
            : `No ${label} notice matched this DOI in the deployed snapshot.`,
        source: "Retraction Watch",
        license: "CC BY 4.0",
      };
    };
    lookups.retractionWatch = {
      retraction: lookupFor(/retract/i, "retraction"),
      expressionOfConcern: lookupFor(/expression|concern/i, "expression of concern"),
      correction: lookupFor(/correct/i, "correction"),
      reinstatement: lookupFor(/reinstate/i, "reinstatement"),
    };
  } catch {
    // An absent or not-yet-migrated authority binding is uncertainty, never a
    // negative credibility inference and never a failed public search.
  }
  return lookups;
}

async function scoreWork(
  work: NormalizedWork,
  authority: D1Database | undefined,
): Promise<ScoredFederatedWork> {
  const lookups = await credibilityLookups(work, authority);
  const type = work.type?.toLowerCase() ?? "";
  const version = /preprint|posted-content/.test(type)
    ? "preprint"
    : type
      ? "other"
      : "unknown";
  return {
    work,
    credibility: scoreCredibility(
      {
        title: work.title,
        authors: work.authors.map((author) => author.name),
        publishedDate: work.publishedDate,
        doi: work.doi,
        canonicalUrl: work.canonicalUrl,
        publisher: work.publisher,
        oaStatus: work.isOpenAccess === true ? "open" : null,
        license: work.evidence.map((item) => item.license).find(Boolean) ?? null,
        version,
      },
      lookups,
    ),
  };
}

function throttledResult(
  adapter: FederationAdapter,
  query: FederationQuery,
  retryAfterMs: number,
): AdapterResult {
  return {
    source: adapter.source,
    query,
    status: {
      kind: "http-error",
      elapsedMs: 0,
      httpStatus: 429,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
      message: "The Allodium deferred this request to respect the upstream rate limit.",
    },
    hits: [],
    nextCursor: null,
  };
}

async function runAdapter(
  adapter: FederationAdapter,
  query: FederationQuery,
  bindings: FederationBindings,
): Promise<AdapterResult> {
  const permit = await requestUpstreamPermit(bindings.UPSTREAM_RATE_LIMITER, adapter.source);
  if (!permit.allowed) return throttledResult(adapter, query, permit.retryAfterMs);
  return adapter.search(query, {
    timeoutMs: 2_500,
    contactEmail: bindings.FEDERATION_CONTACT_EMAIL,
  });
}

export async function searchFederation(
  bindings: FederationBindings,
  query: FederationQuery,
  executionContext?: WaitUntilContext,
): Promise<FederatedSearchResponse> {
  const normalizedQuery: FederationQuery = {
    text: query.text.trim().slice(0, 500),
    pageSize: Math.min(25, Math.max(1, query.pageSize ?? 10)),
    cursor: query.cursor,
  };
  const cache = createSearchCache(bindings.SEARCH_CACHE, executionContext);
  const key = federatedSearchCacheKey(normalizedQuery.text, 1, {
    pageSize: normalizedQuery.pageSize ?? 10,
    cursor: normalizedQuery.cursor ?? null,
  });
  const cached = await cache.get<FederatedSearchResponse>(key);
  if (cached) return { ...cached, cached: true };

  const adapters = await Promise.all(
    PUBLIC_FEDERATION_ADAPTERS.map((adapter) =>
      runAdapter(adapter, normalizedQuery, bindings),
    ),
  );
  const merged = dedupeAndMergeWorks(adapters.flatMap((result) => result.hits));
  const works = await Promise.all(
    merged.map((work) => scoreWork(work, bindings.AUTHORITY)),
  );
  const response: FederatedSearchResponse = {
    query: normalizedQuery,
    works,
    adapters,
    partial: adapters.some((result) => result.status.kind !== "ok"),
    cached: false,
  };
  await cache.put(key, response);
  return response;
}

async function lookupCrossrefWork(
  bindings: FederationBindings,
  doi: string,
): Promise<NormalizedWork | null> {
  const permit = await requestUpstreamPermit(bindings.UPSTREAM_RATE_LIMITER, "crossref");
  if (!permit.allowed) return null;
  const result = await getCrossrefWorkByDoi(doi, {
    timeoutMs: 2_500,
    contactEmail: bindings.FEDERATION_CONTACT_EMAIL,
  });
  return result.hits.find((work) => normalizeDoi(work.doi) === doi) ?? null;
}

export async function resolveFederatedWork(
  bindings: FederationBindings,
  rawDoi: string,
  executionContext?: WaitUntilContext,
): Promise<ScoredFederatedWork | null> {
  const doi = normalizeDoi(rawDoi);
  if (!doi) return null;

  const cache = createSearchCache(bindings.SEARCH_CACHE, executionContext);
  const key = federatedIdentifierCacheKey(doi);
  const cached = await cache.get<ScoredFederatedWork>(key);
  if (cached) return cached;

  const direct = await lookupCrossrefWork(bindings, doi);
  if (direct) {
    const item = await scoreWork(direct, bindings.AUTHORITY);
    await cache.put(key, item, IDENTIFIER_LOOKUP_TTL_SECONDS);
    return item;
  }

  const result = await searchFederation(
    bindings,
    { text: doi, pageSize: 10 },
    executionContext,
  );
  const item = result.works.find((entry) => normalizeDoi(entry.work.doi) === doi) ?? null;
  if (item) await cache.put(key, item, IDENTIFIER_LOOKUP_TTL_SECONDS);
  return item;
}
