export const CREDIBILITY_POLICY_VERSION = "1.0.0" as const;

export type SignalPolarity = "positive" | "caution" | "negative" | "neutral";

export type CredibilityBand =
  | "serious-concern"
  | "limited-evidence"
  | "uncertain"
  | "supported"
  | "strongly-supported";

export type WorkVersion = "preprint" | "version-of-record" | "other" | "unknown";

/**
 * A caller-normalized work. Strings are deliberately opaque: scoring does not
 * parse publisher names, infer affiliations, or make network requests.
 */
export type CredibilityWork = {
  title?: string | null;
  authors?: readonly string[] | null;
  publishedDate?: string | null;
  doi?: string | null;
  canonicalUrl?: string | null;
  publisher?: string | null;
  affiliations?: readonly string[] | null;
  oaStatus?: string | null;
  license?: string | null;
  version?: WorkVersion | null;
};

/**
 * `matched: null` means not checked or indeterminate. `matched: false` means
 * the named authority was checked and did not match; allow-list misses remain
 * neutral. Source and license describe the evidence dataset, not the article.
 */
export type AuthorityLookup = {
  matched: boolean | null;
  evidence: string;
  source: string;
  license: string;
};

export type RetractionWatchLookups = {
  retraction?: AuthorityLookup;
  expressionOfConcern?: AuthorityLookup;
  correction?: AuthorityLookup;
  reinstatement?: AuthorityLookup;
};

export type AuthorityLookups = {
  doiRegistered?: AuthorityLookup;
  doiResolves?: AuthorityLookup;
  doaj?: AuthorityLookup;
  medline?: AuthorityLookup;
  openAlexCore?: AuthorityLookup;
  knownPublisher?: AuthorityLookup;
  rorAffiliation?: AuthorityLookup;
  retractionWatch?: RetractionWatchLookups;
};

export type CredibilitySignalId =
  | "doi-registered"
  | "doi-resolving"
  | "doaj"
  | "medline"
  | "openalex-core"
  | "known-publisher"
  | "ror-affiliation"
  | "retraction-watch-retraction"
  | "retraction-watch-expression-of-concern"
  | "retraction-watch-correction"
  | "retraction-watch-reinstatement"
  | "open-access"
  | "license"
  | "publication-version"
  | "metadata-completeness";

export type CredibilitySignal = {
  id: CredibilitySignalId;
  version: typeof CREDIBILITY_POLICY_VERSION;
  label: string;
  polarity: SignalPolarity;
  evidence: string;
  source: string;
  license: string;
  contribution?: number;
};

export type CredibilityResult = {
  policyVersion: typeof CREDIBILITY_POLICY_VERSION;
  score: number;
  band: CredibilityBand;
  signals: CredibilitySignal[];
  uncertainty: string[];
};
