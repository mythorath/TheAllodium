export const FEDERATION_SOURCES = [
  "crossref",
  "europe-pmc",
  "datacite",
  "pubmed",
  "doaj",
  "zenodo",
  "hal",
  "arxiv",
  "doab",
  "dblp",
] as const;

export type FederationSource = (typeof FEDERATION_SOURCES)[number];

export type WorkAuthor = {
  name: string;
  familyName: string | null;
  givenName: string | null;
  orcid: string | null;
};

export type SourceEvidence = {
  source: FederationSource;
  sourceId: string;
  recordUrl: string | null;
  retrievedAt: string;
  fields: readonly string[];
  rank: number | null;
  license: string | null;
};

/**
 * Public-safe bibliographic metadata. Abstract text is deliberately absent:
 * upstream abstracts may be used for transient ranking but never redistributed.
 */
export type NormalizedWork = {
  title: string;
  authors: readonly WorkAuthor[];
  publicationYear: number | null;
  publishedDate: string | null;
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
  pmcid: string | null;
  type: string | null;
  containerTitle: string | null;
  publisher: string | null;
  canonicalUrl: string | null;
  isOpenAccess: boolean | null;
  evidence: readonly SourceEvidence[];
};

export type FederationQuery = {
  text: string;
  pageSize?: number;
  cursor?: string;
};

export type AdapterSuccessStatus = {
  kind: "ok";
  httpStatus: number;
  elapsedMs: number;
};

export type AdapterFailureStatus =
  | {
      kind: "timeout";
      elapsedMs: number;
      timeoutMs: number;
    }
  | {
      kind: "http-error";
      elapsedMs: number;
      httpStatus: number;
      retryAfterSeconds: number | null;
      message: string;
    }
  | {
      kind: "network-error";
      elapsedMs: number;
      message: string;
    }
  | {
      kind: "invalid-response";
      elapsedMs: number;
      httpStatus: number;
      message: string;
    }
  | {
      kind: "invalid-query";
      elapsedMs: number;
      message: string;
    };

export type AdapterStatus = AdapterSuccessStatus | AdapterFailureStatus;

export type AdapterResult = {
  source: FederationSource;
  query: FederationQuery;
  status: AdapterStatus;
  hits: readonly NormalizedWork[];
  nextCursor: string | null;
};

export type AdapterOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  contactEmail?: string;
};

export type FederationAdapter = {
  source: FederationSource;
  search: (
    query: FederationQuery,
    options?: AdapterOptions,
  ) => Promise<AdapterResult>;
};

export type MergedFederationResult = {
  query: FederationQuery;
  works: readonly NormalizedWork[];
  adapters: readonly AdapterResult[];
  partial: boolean;
};
