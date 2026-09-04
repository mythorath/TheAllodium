import { normalizeDoi } from "./identity";
import type {
  AdapterOptions,
  AdapterResult,
  FederationAdapter,
  FederationQuery,
  FederationSource,
  NormalizedWork,
  SourceEvidence,
  WorkAuthor,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type JsonRecord = Record<string, unknown>;
type OperationResult = {
  hits: readonly NormalizedWork[];
  nextCursor: string | null;
  httpStatus: number;
};
type AdapterOperation = (
  fetcher: typeof fetch,
  signal: AbortSignal,
  retrievedAt: string,
) => Promise<OperationResult>;

class HttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, retryAfterSeconds: number | null) {
    super(`Upstream returned HTTP ${status}`);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class InvalidResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function firstText(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(text).find((item): item is string => item !== null) ?? null;
  }
  return text(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function yearFrom(value: unknown): number | null {
  const match = firstText(value)?.match(/\b(?:18|19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function dateParts(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const parts = records(value["date-parts"])[0];
  if (parts) return null;
  const raw = value["date-parts"];
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return null;
  const values = raw[0].filter(
    (part): part is number => typeof part === "number" && Number.isInteger(part),
  );
  if (values.length === 0) return null;
  return values
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
}

function author(
  name: string,
  familyName: string | null = null,
  givenName: string | null = null,
  orcid: string | null = null,
): WorkAuthor {
  return { name, familyName, givenName, orcid };
}

function evidence(
  source: FederationSource,
  sourceId: string,
  recordUrl: string | null,
  retrievedAt: string,
  fields: readonly string[],
  rank: number,
  license: string | null = null,
): SourceEvidence {
  return {
    source,
    sourceId,
    recordUrl,
    retrievedAt,
    fields,
    rank,
    license,
  };
}

function pageSize(query: FederationQuery): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
}

function queryProblem(query: FederationQuery): string | null {
  const length = query.text.trim().length;
  if (length < 2) return "Query must contain at least two non-whitespace characters";
  if (length > 500) return "Query must not exceed 500 characters";
  if (query.pageSize !== undefined && !Number.isInteger(query.pageSize)) {
    return "pageSize must be an integer";
  }
  return null;
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isNaN(date)
    ? null
    : Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

async function getJson(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
  headers?: HeadersInit,
): Promise<{ body: unknown; status: number; response: Response }> {
  const response = await fetcher(url, { signal, headers });
  if (!response.ok) throw new HttpError(response.status, retryAfter(response));
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InvalidResponseError(response.status, "Upstream did not return JSON");
  }
  return { body, status: response.status, response };
}

async function getText(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
  headers?: HeadersInit,
): Promise<{ body: string; status: number }> {
  const response = await fetcher(url, { signal, headers });
  if (!response.ok) throw new HttpError(response.status, retryAfter(response));
  try {
    return { body: await response.text(), status: response.status };
  } catch {
    throw new InvalidResponseError(response.status, "Upstream body was unreadable");
  }
}

async function runAdapter(
  source: FederationSource,
  query: FederationQuery,
  options: AdapterOptions,
  operation: AdapterOperation,
): Promise<AdapterResult> {
  const started = Date.now();
  const invalid = queryProblem(query);
  if (invalid) {
    return {
      source,
      query,
      status: { kind: "invalid-query", elapsedMs: Date.now() - started, message: invalid },
      hits: [],
      nextCursor: null,
    };
  }

  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DOMException("Federation request timed out", "AbortError"));
      }, timeoutMs);
    });
    const result = await Promise.race([
      operation(
        options.fetch ?? fetch,
        controller.signal,
        (options.now ?? (() => new Date()))().toISOString(),
      ),
      timeout,
    ]);
    return {
      source,
      query,
      status: {
        kind: "ok",
        httpStatus: result.httpStatus,
        elapsedMs: Date.now() - started,
      },
      hits: result.hits,
      nextCursor: result.nextCursor,
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      return {
        source,
        query,
        status: { kind: "timeout", elapsedMs, timeoutMs },
        hits: [],
        nextCursor: null,
      };
    }
    if (error instanceof HttpError) {
      return {
        source,
        query,
        status: {
          kind: "http-error",
          elapsedMs,
          httpStatus: error.status,
          retryAfterSeconds: error.retryAfterSeconds,
          message: error.message,
        },
        hits: [],
        nextCursor: null,
      };
    }
    if (error instanceof InvalidResponseError) {
      return {
        source,
        query,
        status: {
          kind: "invalid-response",
          elapsedMs,
          httpStatus: error.status,
          message: error.message,
        },
        hits: [],
        nextCursor: null,
      };
    }
    return {
      source,
      query,
      status: {
        kind: "network-error",
        elapsedMs,
        message: error instanceof Error ? error.message : "Unknown network error",
      },
      hits: [],
      nextCursor: null,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function crossrefWork(item: JsonRecord, retrievedAt: string, rank: number): NormalizedWork {
  const doi = normalizeDoi(text(item.DOI));
  const publishedDate = dateParts(item.published) ?? dateParts(item.issued);
  const authors = records(item.author).map((entry) => {
    const given = text(entry.given);
    const family = text(entry.family);
    return author(
      [given, family].filter(Boolean).join(" ") || "Unknown",
      family,
      given,
      text(entry.ORCID)?.replace(/^https?:\/\/orcid\.org\//, "") ?? null,
    );
  });
  const sourceId = doi ?? text(item.URL) ?? `rank-${rank}`;
  const recordUrl = text(item.URL) ?? (doi ? `https://doi.org/${doi}` : null);
  return {
    title: firstText(item.title) ?? "Untitled",
    authors,
    publicationYear: yearFrom(publishedDate),
    publishedDate,
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    type: text(item.type),
    containerTitle: firstText(item["container-title"]),
    publisher: text(item.publisher),
    canonicalUrl: recordUrl,
    isOpenAccess: null,
    evidence: [
      evidence("crossref", sourceId, recordUrl, retrievedAt, Object.keys(item), rank),
    ],
  };
}

export async function searchCrossref(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("crossref", query, options, async (fetcher, signal, retrievedAt) => {
    const params = new URLSearchParams({
      "query.bibliographic": query.text.trim(),
      rows: String(pageSize(query)),
      cursor: query.cursor ?? "*",
    });
    if (options.contactEmail) params.set("mailto", options.contactEmail);
    const { body, status } = await getJson(
      fetcher,
      `https://api.crossref.org/works?${params}`,
      signal,
    );
    const message = isRecord(body) && isRecord(body.message) ? body.message : null;
    if (!message) throw new InvalidResponseError(status, "Missing Crossref message");
    return {
      hits: records(message.items).map((item, rank) =>
        crossrefWork(item, retrievedAt, rank),
      ),
      nextCursor: text(message["next-cursor"]),
      httpStatus: status,
    };
  });
}

function europePmcWork(
  item: JsonRecord,
  retrievedAt: string,
  rank: number,
): NormalizedWork {
  const doi = normalizeDoi(text(item.doi));
  const pmid = text(item.pmid);
  const pmcid = text(item.pmcid);
  const sourceId = pmid ?? pmcid ?? doi ?? text(item.id) ?? `rank-${rank}`;
  const names = strings(item.authorString ? String(item.authorString).split(",") : []);
  const authors = names.map((name) => author(name));
  const recordUrl = pmid
    ? `https://europepmc.org/article/MED/${pmid}`
    : pmcid
      ? `https://europepmc.org/article/PMC/${pmcid}`
      : doi
        ? `https://doi.org/${doi}`
        : null;
  return {
    title: text(item.title) ?? "Untitled",
    authors,
    publicationYear: numberValue(item.pubYear),
    publishedDate: text(item.firstPublicationDate),
    doi,
    arxivId: null,
    pmid,
    pmcid,
    type: text(item.pubType),
    containerTitle: text(item.journalTitle),
    publisher: null,
    canonicalUrl: recordUrl,
    isOpenAccess:
      typeof item.isOpenAccess === "string"
        ? item.isOpenAccess.toUpperCase() === "Y"
        : null,
    evidence: [
      evidence("europe-pmc", sourceId, recordUrl, retrievedAt, Object.keys(item), rank),
    ],
  };
}

export async function searchEuropePmc(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter(
    "europe-pmc",
    query,
    options,
    async (fetcher, signal, retrievedAt) => {
      const params = new URLSearchParams({
        query: query.text.trim(),
        format: "json",
        resultType: "lite",
        pageSize: String(pageSize(query)),
        cursorMark: query.cursor ?? "*",
      });
      const { body, status } = await getJson(
        fetcher,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`,
        signal,
      );
      if (!isRecord(body) || !isRecord(body.resultList)) {
        throw new InvalidResponseError(status, "Missing Europe PMC resultList");
      }
      return {
        hits: records(body.resultList.result).map((item, rank) =>
          europePmcWork(item, retrievedAt, rank),
        ),
        nextCursor: text(body.nextCursorMark),
        httpStatus: status,
      };
    },
  );
}

function dataciteWork(item: JsonRecord, retrievedAt: string, rank: number): NormalizedWork {
  const attributes = isRecord(item.attributes) ? item.attributes : {};
  const doi = normalizeDoi(text(attributes.doi) ?? text(item.id));
  const authors = records(attributes.creators).map((entry) =>
    author(
      text(entry.name) ??
        ([text(entry.givenName), text(entry.familyName)]
          .filter(Boolean)
          .join(" ") ||
          "Unknown"),
      text(entry.familyName),
      text(entry.givenName),
      records(entry.nameIdentifiers).map((id) => text(id.nameIdentifier)).find(Boolean) ??
        null,
    ),
  );
  const title = records(attributes.titles)
    .map((entry) => text(entry.title))
    .find((itemTitle): itemTitle is string => itemTitle !== null);
  const recordUrl = text(attributes.url) ?? (doi ? `https://doi.org/${doi}` : null);
  const rights = records(attributes.rightsList);
  return {
    title: title ?? "Untitled",
    authors,
    publicationYear: numberValue(attributes.publicationYear),
    publishedDate: text(attributes.published),
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    type: text(attributes.types && isRecord(attributes.types) ? attributes.types.resourceTypeGeneral : null),
    containerTitle: firstText(attributes.container),
    publisher: text(attributes.publisher),
    canonicalUrl: recordUrl,
    isOpenAccess: rights.some((right) =>
      /open|creative commons|^cc[- ]/i.test(
        text(right.rights) ?? text(right.rightsIdentifier) ?? "",
      ),
    ),
    evidence: [
      evidence(
        "datacite",
        text(item.id) ?? doi ?? `rank-${rank}`,
        recordUrl,
        retrievedAt,
        Object.keys(attributes),
        rank,
        rights.map((right) => text(right.rightsUri)).find(Boolean) ?? null,
      ),
    ],
  };
}

export async function searchDataCite(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("datacite", query, options, async (fetcher, signal, retrievedAt) => {
    const params = new URLSearchParams({
      query: query.text.trim(),
      "page[size]": String(pageSize(query)),
    });
    if (query.cursor && /^\d+$/.test(query.cursor)) {
      params.set("page[number]", query.cursor);
    }
    if (options.contactEmail) params.set("mailto", options.contactEmail);
    const { body, status } = await getJson(
      fetcher,
      `https://api.datacite.org/dois?${params}`,
      signal,
    );
    if (!isRecord(body)) {
      throw new InvalidResponseError(status, "Invalid DataCite response");
    }
    const current = numberValue(
      isRecord(body.meta) ? body.meta.page : query.cursor ?? "1",
    ) ?? 1;
    const hasNext = isRecord(body.links) && text(body.links.next) !== null;
    return {
      hits: records(body.data).map((item, rank) =>
        dataciteWork(item, retrievedAt, rank),
      ),
      nextCursor: hasNext ? String(current + 1) : null,
      httpStatus: status,
    };
  });
}

function pubmedWork(item: JsonRecord, retrievedAt: string, rank: number): NormalizedWork {
  const pmid = text(item.uid) ?? `rank-${rank}`;
  const articleIds = records(item.articleids);
  const doi = normalizeDoi(
    articleIds
      .filter((id) => text(id.idtype)?.toLowerCase() === "doi")
      .map((id) => text(id.value))
      .find((value): value is string => value !== null),
  );
  const pmcid =
    articleIds
      .filter((id) => text(id.idtype)?.toLowerCase() === "pmc")
      .map((id) => text(id.value))
      .find((value): value is string => value !== null) ?? null;
  const authors = records(item.authors).map((entry) =>
    author(text(entry.name) ?? "Unknown"),
  );
  const recordUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return {
    title: text(item.title) ?? "Untitled",
    authors,
    publicationYear: yearFrom(item.pubdate),
    publishedDate: text(item.pubdate),
    doi,
    arxivId: null,
    pmid,
    pmcid,
    type: firstText(item.pubtype),
    containerTitle: text(item.fulljournalname) ?? text(item.source),
    publisher: null,
    canonicalUrl: recordUrl,
    isOpenAccess: pmcid !== null ? true : null,
    evidence: [
      evidence("pubmed", pmid, recordUrl, retrievedAt, Object.keys(item), rank),
    ],
  };
}

export async function searchPubMed(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("pubmed", query, options, async (fetcher, signal, retrievedAt) => {
    const common = new URLSearchParams({
      db: "pubmed",
      retmode: "json",
      tool: "the_allodium",
    });
    if (options.contactEmail) common.set("email", options.contactEmail);
    const searchParams = new URLSearchParams(common);
    searchParams.set("term", query.text.trim());
    searchParams.set("retmax", String(pageSize(query)));
    searchParams.set("retstart", query.cursor && /^\d+$/.test(query.cursor) ? query.cursor : "0");
    const search = await getJson(
      fetcher,
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`,
      signal,
    );
    const searchResult =
      isRecord(search.body) && isRecord(search.body.esearchresult)
        ? search.body.esearchresult
        : null;
    if (!searchResult) {
      throw new InvalidResponseError(search.status, "Missing PubMed esearchresult");
    }
    const ids = strings(searchResult.idlist);
    if (ids.length === 0) {
      return { hits: [], nextCursor: null, httpStatus: search.status };
    }
    const summaryParams = new URLSearchParams(common);
    summaryParams.set("id", ids.join(","));
    const summary = await getJson(
      fetcher,
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`,
      signal,
    );
    const result =
      isRecord(summary.body) && isRecord(summary.body.result)
        ? summary.body.result
        : null;
    if (!result) {
      throw new InvalidResponseError(summary.status, "Missing PubMed summary result");
    }
    const start = numberValue(searchResult.retstart) ?? 0;
    const count = numberValue(searchResult.count) ?? ids.length;
    const next = start + ids.length;
    return {
      hits: ids
        .map((id) => result[id])
        .filter(isRecord)
        .map((item, rank) => pubmedWork(item, retrievedAt, rank)),
      nextCursor: next < count ? String(next) : null,
      httpStatus: summary.status,
    };
  });
}

function doajWork(item: JsonRecord, retrievedAt: string, rank: number): NormalizedWork {
  const bibjson = isRecord(item.bibjson) ? item.bibjson : {};
  const identifiers = records(bibjson.identifier);
  const doi = normalizeDoi(
    identifiers
      .filter((id) => text(id.type)?.toLowerCase() === "doi")
      .map((id) => text(id.id))
      .find((value): value is string => value !== null),
  );
  const authors = records(bibjson.author).map((entry) =>
    author(text(entry.name) ?? "Unknown", null, null, text(entry.orcid)),
  );
  const links = records(bibjson.link);
  const recordUrl =
    links.map((link) => text(link.url)).find((value): value is string => value !== null) ??
    (doi ? `https://doi.org/${doi}` : null);
  const journal = isRecord(bibjson.journal) ? bibjson.journal : {};
  const sourceId = text(item.id) ?? doi ?? `rank-${rank}`;
  return {
    title: text(bibjson.title) ?? "Untitled",
    authors,
    publicationYear: numberValue(bibjson.year),
    publishedDate: text(bibjson.month),
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    type: "journal-article",
    containerTitle: text(journal.title),
    publisher: text(isRecord(journal.publisher) ? journal.publisher.name : null),
    canonicalUrl: recordUrl,
    isOpenAccess: true,
    evidence: [
      evidence(
        "doaj",
        sourceId,
        recordUrl,
        retrievedAt,
        Object.keys(bibjson),
        rank,
        text(isRecord(bibjson.license) ? bibjson.license.type : null),
      ),
    ],
  };
}

export async function searchDoaj(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("doaj", query, options, async (fetcher, signal, retrievedAt) => {
    const page =
      query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 1;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize(query)),
    });
    const { body, status } = await getJson(
      fetcher,
      `https://doaj.org/api/search/articles/${encodeURIComponent(query.text.trim())}?${params}`,
      signal,
      { Accept: "application/json" },
    );
    if (!isRecord(body)) throw new InvalidResponseError(status, "Invalid DOAJ response");
    const total = numberValue(body.total) ?? 0;
    return {
      hits: records(body.results).map((item, rank) =>
        doajWork(item, retrievedAt, rank),
      ),
      nextCursor: page * pageSize(query) < total ? String(page + 1) : null,
      httpStatus: status,
    };
  });
}

function zenodoIdentifier(
  metadata: JsonRecord,
  scheme: string,
): string | null {
  return (
    records(metadata.identifiers)
      .filter((identifier) => text(identifier.scheme)?.toLowerCase() === scheme)
      .map((identifier) => text(identifier.identifier))
      .find((value): value is string => value !== null) ?? null
  );
}

function zenodoWork(
  item: JsonRecord,
  retrievedAt: string,
  rank: number,
): NormalizedWork {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const pids = isRecord(item.pids) ? item.pids : {};
  const doiPid = isRecord(pids.doi) ? pids.doi : {};
  const doi = normalizeDoi(
    text(doiPid.identifier) ?? text(metadata.doi) ?? zenodoIdentifier(metadata, "doi"),
  );
  const authors = records(metadata.creators).map((creator) => {
    const person = isRecord(creator.person_or_org) ? creator.person_or_org : creator;
    const identifiers = records(person.identifiers);
    const orcid =
      identifiers
        .filter((identifier) => text(identifier.scheme)?.toLowerCase() === "orcid")
        .map((identifier) => text(identifier.identifier))
        .find((value): value is string => value !== null) ?? null;
    return author(
      text(person.name) ??
        ([text(person.given_name), text(person.family_name)]
          .filter(Boolean)
          .join(" ") ||
          "Unknown"),
      text(person.family_name),
      text(person.given_name),
      orcid,
    );
  });
  const links = isRecord(item.links) ? item.links : {};
  const access = isRecord(item.access) ? item.access : {};
  const resourceType = isRecord(metadata.resource_type)
    ? metadata.resource_type
    : {};
  const rights = records(metadata.rights);
  const sourceId = text(item.id) ?? doi ?? `rank-${rank}`;
  const recordUrl =
    text(links.self_html) ??
    text(links.html) ??
    (sourceId.startsWith("rank-")
      ? null
      : `https://zenodo.org/records/${sourceId}`);
  return {
    title: text(metadata.title) ?? "Untitled",
    authors,
    publicationYear: yearFrom(metadata.publication_date),
    publishedDate: text(metadata.publication_date),
    doi,
    arxivId: zenodoIdentifier(metadata, "arxiv"),
    pmid: zenodoIdentifier(metadata, "pmid"),
    pmcid: zenodoIdentifier(metadata, "pmcid"),
    type: text(resourceType.type) ?? text(resourceType.title),
    containerTitle: text(isRecord(metadata.journal) ? metadata.journal.title : null),
    publisher: text(metadata.publisher),
    canonicalUrl: recordUrl,
    isOpenAccess:
      text(access.status)?.toLowerCase() === "open"
        ? true
        : text(access.status) !== null
          ? false
          : null,
    evidence: [
      evidence(
        "zenodo",
        sourceId,
        recordUrl,
        retrievedAt,
        [
          "title",
          "creators",
          "publication_date",
          "doi",
          "identifiers",
          "resource_type",
          "journal",
          "publisher",
          "rights",
          "access",
        ],
        rank,
        rights
          .map((right) =>
            text(isRecord(right.props) ? right.props.url : null) ??
            text(right.id) ??
            text(right.title),
          )
          .find((value): value is string => value !== null) ?? null,
      ),
    ],
  };
}

export async function searchZenodo(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("zenodo", query, options, async (fetcher, signal, retrievedAt) => {
    const page =
      query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 1;
    const params = new URLSearchParams({
      q: query.text.trim(),
      size: String(pageSize(query)),
      page: String(page),
    });
    const { body, status } = await getJson(
      fetcher,
      `https://zenodo.org/api/records?${params}`,
      signal,
      { Accept: "application/json" },
    );
    const hits = isRecord(body) && isRecord(body.hits) ? body.hits : null;
    if (!hits) throw new InvalidResponseError(status, "Missing Zenodo hits");
    const total = isRecord(hits.total)
      ? numberValue(hits.total.value)
      : numberValue(hits.total);
    const links = isRecord(body) && isRecord(body.links) ? body.links : {};
    const hasNext =
      text(links.next) !== null ||
      (total !== null && page * pageSize(query) < total);
    return {
      hits: records(hits.hits).map((item, rank) =>
        zenodoWork(item, retrievedAt, rank),
      ),
      nextCursor: hasNext ? String(page + 1) : null,
      httpStatus: status,
    };
  });
}

function indexedText(value: unknown, index: number): string | null {
  if (Array.isArray(value)) return text(value[index]);
  return index === 0 ? text(value) : null;
}

function halWork(
  item: JsonRecord,
  retrievedAt: string,
  rank: number,
): NormalizedWork {
  const authorNames = strings(item.authFullName_s);
  const authors = authorNames.map((name, index) =>
    author(
      name,
      indexedText(item.authLastName_s, index),
      indexedText(item.authFirstName_s, index),
      null,
    ),
  );
  const doi = normalizeDoi(firstText(item.doiId_s));
  const halId = firstText(item.halId_s) ?? `rank-${rank}`;
  const recordUrl =
    firstText(item.uri_s) ??
    (halId.startsWith("rank-") ? null : `https://hal.science/${halId}`);
  const publishedDate =
    firstText(item.publicationDate_s) ?? firstText(item.producedDate_tdate);
  const openAccess = item.openAccess_bool;
  return {
    title: firstText(item.title_s) ?? "Untitled",
    authors,
    publicationYear: yearFrom(publishedDate),
    publishedDate,
    doi,
    arxivId: firstText(item.arxivId_s),
    pmid: firstText(item.pubmedId_s),
    pmcid: null,
    type: firstText(item.docType_s),
    containerTitle: firstText(item.journalTitle_s),
    publisher: firstText(item.publisher_s),
    canonicalUrl: recordUrl,
    isOpenAccess: typeof openAccess === "boolean" ? openAccess : null,
    evidence: [
      evidence(
        "hal",
        halId,
        recordUrl,
        retrievedAt,
        Object.keys(item),
        rank,
      ),
    ],
  };
}

export async function searchHal(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("hal", query, options, async (fetcher, signal, retrievedAt) => {
    const start =
      query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
    const params = new URLSearchParams({
      q: query.text.trim(),
      rows: String(pageSize(query)),
      start: String(start),
      wt: "json",
      fl: [
        "halId_s",
        "title_s",
        "authFullName_s",
        "authLastName_s",
        "authFirstName_s",
        "publicationDate_s",
        "producedDate_tdate",
        "doiId_s",
        "arxivId_s",
        "pubmedId_s",
        "docType_s",
        "journalTitle_s",
        "publisher_s",
        "uri_s",
        "openAccess_bool",
      ].join(","),
    });
    const { body, status } = await getJson(
      fetcher,
      `https://api.archives-ouvertes.fr/search/?${params}`,
      signal,
      { Accept: "application/json" },
    );
    const response = isRecord(body) && isRecord(body.response) ? body.response : null;
    if (!response) throw new InvalidResponseError(status, "Missing HAL response");
    const docs = records(response.docs);
    const total = numberValue(response.numFound) ?? docs.length;
    const next = start + docs.length;
    return {
      hits: docs.map((item, rank) => halWork(item, retrievedAt, rank)),
      nextCursor: docs.length > 0 && next < total ? String(next) : null,
      httpStatus: status,
    };
  });
}

function decodeXml(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const radix = code[0].toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? code.slice(1) : code;
      const point = Number.parseInt(digits, radix);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&(amp|apos|gt|lt|quot);/g, (_, name: string) => named[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block: string, tag: string): string | null {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]) : null;
}

function xmlTags(block: string, tag: string): string[] {
  return [...block.matchAll(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"),
  )].map((match) => decodeXml(match[1]));
}

function xmlAttribute(block: string, tag: string, attribute: string): string | null {
  const match = block.match(
    new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*\\/?>`, "i"),
  );
  return match ? decodeXml(match[1]) : null;
}

function arxivWork(
  entry: string,
  retrievedAt: string,
  rank: number,
): NormalizedWork {
  const idUrl = xmlTag(entry, "id");
  const rawId = idUrl?.match(/\/abs\/([^?#]+)/)?.[1] ?? null;
  const arxivId = rawId?.replace(/v\d+$/i, "") ?? null;
  const doi = normalizeDoi(xmlTag(entry, "arxiv:doi"));
  const publishedDate = xmlTag(entry, "published");
  const names = xmlTags(entry, "name");
  const recordUrl =
    xmlAttribute(entry, "link", "href") ??
    (arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl);
  return {
    title: xmlTag(entry, "title") ?? "Untitled",
    authors: names.map((name) => author(name)),
    publicationYear: yearFrom(publishedDate),
    publishedDate,
    doi,
    arxivId,
    pmid: null,
    pmcid: null,
    type: xmlAttribute(entry, "category", "term") ?? "preprint",
    containerTitle: xmlTag(entry, "arxiv:journal_ref"),
    publisher: "arXiv",
    canonicalUrl: recordUrl,
    isOpenAccess: true,
    evidence: [
      evidence(
        "arxiv",
        arxivId ?? idUrl ?? `rank-${rank}`,
        recordUrl,
        retrievedAt,
        [
          "id",
          "title",
          "author/name",
          "published",
          "arxiv:doi",
          "arxiv:journal_ref",
          "category",
          "link",
        ],
        rank,
        "https://info.arxiv.org/help/license/index.html",
      ),
    ],
  };
}

export async function searchArxiv(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("arxiv", query, options, async (fetcher, signal, retrievedAt) => {
    const start =
      query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
    const escaped = query.text.trim().replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    const params = new URLSearchParams({
      search_query: `all:"${escaped}"`,
      start: String(start),
      max_results: String(pageSize(query)),
      sortBy: "relevance",
      sortOrder: "descending",
    });
    const { body, status } = await getText(
      fetcher,
      `https://export.arxiv.org/api/query?${params}`,
      signal,
      { Accept: "application/atom+xml" },
    );
    if (!/<feed(?:\s|>)/i.test(body)) {
      throw new InvalidResponseError(status, "Missing arXiv Atom feed");
    }
    const entries = [...body.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)]
      .map((match) => match[1]);
    const total = numberValue(xmlTag(body, "opensearch:totalResults")) ?? entries.length;
    const next = start + entries.length;
    return {
      hits: entries.map((entry, rank) => arxivWork(entry, retrievedAt, rank)),
      nextCursor: entries.length > 0 && next < total ? String(next) : null,
      httpStatus: status,
    };
  });
}

function metadataValues(metadata: readonly JsonRecord[], key: string): string[] {
  return metadata
    .filter((entry) => text(entry.key)?.toLowerCase() === key)
    .map((entry) => text(entry.value))
    .filter((value): value is string => value !== null);
}

function doabWork(
  item: JsonRecord,
  retrievedAt: string,
  rank: number,
): NormalizedWork {
  const metadata = records(item.metadata);
  const metadataValue = (key: string): string | null =>
    metadataValues(metadata, key)[0] ?? null;
  const handle = text(item.handle);
  const doi = normalizeDoi(
    metadataValue("dc.identifier.doi") ??
    metadataValues(metadata, "dc.identifier").find((value) =>
      /^(?:doi:|https?:\/\/doi\.org\/|10\.)/i.test(value),
    ),
  );
  const sourceId = text(item.uuid) ?? handle ?? doi ?? `rank-${rank}`;
  const recordUrl =
    metadataValue("dc.identifier.uri") ??
    (handle ? `https://directory.doabooks.org/handle/${handle}` : null) ??
    (doi ? `https://doi.org/${doi}` : null);
  const issued =
    metadataValue("dc.date.issued") ?? metadataValue("dc.date.available");
  return {
    title: metadataValue("dc.title") ?? text(item.name) ?? "Untitled",
    authors: [
      ...metadataValues(metadata, "dc.contributor.author"),
      ...metadataValues(metadata, "dc.creator"),
    ].map((name) => author(name)),
    publicationYear: yearFrom(issued),
    publishedDate: issued,
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    type: metadataValue("dc.type") ?? text(item.type),
    containerTitle: metadataValue("dc.relation.ispartof"),
    publisher: metadataValue("dc.publisher"),
    canonicalUrl: recordUrl,
    isOpenAccess: true,
    evidence: [
      evidence(
        "doab",
        sourceId,
        recordUrl,
        retrievedAt,
        [
          "dc.title",
          "dc.contributor.author",
          "dc.creator",
          "dc.date.issued",
          "dc.identifier.doi",
          "dc.identifier.uri",
          "dc.publisher",
          "dc.type",
          "dc.rights",
        ],
        rank,
        metadataValue("dc.rights.uri") ?? metadataValue("dc.rights"),
      ),
    ],
  };
}

export async function searchDoab(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("doab", query, options, async (fetcher, signal, retrievedAt) => {
    const offset =
      query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
    const params = new URLSearchParams({
      query: query.text.trim(),
      expand: "metadata",
      limit: String(pageSize(query)),
      offset: String(offset),
    });
    const { body, status, response } = await getJson(
      fetcher,
      `https://directory.doabooks.org/rest/search?${params}`,
      signal,
      { Accept: "application/json" },
    );
    const items = Array.isArray(body)
      ? records(body)
      : isRecord(body)
        ? records(body.items).length > 0
          ? records(body.items)
          : records(body.results)
        : [];
    if (!Array.isArray(body) && !isRecord(body)) {
      throw new InvalidResponseError(status, "Invalid DOAB response");
    }
    const totalHeader = numberValue(response.headers.get("x-total-count"));
    const total = isRecord(body) ? numberValue(body.total) ?? totalHeader : totalHeader;
    const next = offset + items.length;
    return {
      hits: items.map((item, rank) => doabWork(item, retrievedAt, rank)),
      nextCursor:
        items.length === pageSize(query) && (total === null || next < total)
          ? String(next)
          : null,
      httpStatus: status,
    };
  });
}

function dblpAuthor(entry: unknown): WorkAuthor {
  if (isRecord(entry)) {
    return author(text(entry.text) ?? text(entry.name) ?? "Unknown");
  }
  return author(text(entry) ?? "Unknown");
}

function dblpWork(
  item: JsonRecord,
  retrievedAt: string,
  rank: number,
): NormalizedWork {
  const info = isRecord(item.info) ? item.info : item;
  const authorContainer = isRecord(info.authors) ? info.authors : {};
  const authorEntries = Array.isArray(authorContainer.author)
    ? authorContainer.author
    : authorContainer.author === undefined
      ? []
      : [authorContainer.author];
  const doi = normalizeDoi(text(info.doi));
  const sourceId = text(info.key) ?? doi ?? text(info.url) ?? `rank-${rank}`;
  const recordUrl =
    text(info.url) ??
    text(info.ee) ??
    (doi ? `https://doi.org/${doi}` : null);
  return {
    title: firstText(info.title) ?? "Untitled",
    authors: authorEntries.map(dblpAuthor),
    publicationYear: numberValue(info.year),
    publishedDate: text(info.year),
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    type: text(info.type),
    containerTitle: text(info.venue),
    publisher: text(info.publisher),
    canonicalUrl: recordUrl,
    isOpenAccess:
      typeof info.access === "string"
        ? info.access.toLowerCase() === "open"
        : null,
    evidence: [
      evidence(
        "dblp",
        sourceId,
        recordUrl,
        retrievedAt,
        Object.keys(info),
        rank,
      ),
    ],
  };
}

export async function searchDblp(
  query: FederationQuery,
  options: AdapterOptions = {},
): Promise<AdapterResult> {
  return runAdapter("dblp", query, options, async (fetcher, signal, retrievedAt) => {
    const offset =
      query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
    const params = new URLSearchParams({
      q: query.text.trim(),
      h: String(pageSize(query)),
      f: String(offset),
      format: "json",
    });
    const { body, status } = await getJson(
      fetcher,
      `https://dblp.org/search/publ/api?${params}`,
      signal,
      { Accept: "application/json" },
    );
    const hits =
      isRecord(body) &&
      isRecord(body.result) &&
      isRecord(body.result.hits)
        ? body.result.hits
        : null;
    if (!hits) throw new InvalidResponseError(status, "Missing DBLP hits");
    const items = records(hits.hit);
    const total = numberValue(hits["@total"]) ?? items.length;
    const first = numberValue(hits["@first"]) ?? offset;
    const next = first + items.length;
    return {
      hits: items.map((item, rank) => dblpWork(item, retrievedAt, rank)),
      nextCursor: items.length > 0 && next < total ? String(next) : null,
      httpStatus: status,
    };
  });
}

export const FEDERATION_ADAPTERS: readonly FederationAdapter[] = [
  { source: "crossref", search: searchCrossref },
  { source: "europe-pmc", search: searchEuropePmc },
  { source: "datacite", search: searchDataCite },
  { source: "pubmed", search: searchPubMed },
  { source: "doaj", search: searchDoaj },
  { source: "zenodo", search: searchZenodo },
  { source: "hal", search: searchHal },
  { source: "arxiv", search: searchArxiv },
  { source: "doab", search: searchDoab },
  { source: "dblp", search: searchDblp },
];

/** Adapters used on every public request. Zenodo remains implemented and
 * monitored, but its origin returned 403/timeouts from Cloudflare egress in
 * the Phase 5A staging spike; DataCite already federates Zenodo DOIs. */
export const PUBLIC_FEDERATION_ADAPTERS: readonly FederationAdapter[] =
  FEDERATION_ADAPTERS.filter((adapter) => adapter.source !== "zenodo");
