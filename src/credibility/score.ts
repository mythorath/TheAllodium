import {
  CREDIBILITY_POLICY_VERSION,
  type AuthorityLookup,
  type AuthorityLookups,
  type CredibilityBand,
  type CredibilityResult,
  type CredibilitySignal,
  type CredibilitySignalId,
  type CredibilityWork,
  type SignalPolarity,
} from "./types";

const BASE_SCORE = 50;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
const UNKNOWN_SOURCE = "No authority result supplied";
const UNKNOWN_LICENSE = "Unknown";
const METADATA_SOURCE = "Normalized work metadata";
const METADATA_LICENSE = "Caller-provided; provenance license not supplied to scorer";

type SignalDefinition = {
  id: AllowListSignalId;
  label: string;
  positiveContribution: number;
};

type AllowListSignalId =
  | "doaj"
  | "medline"
  | "openalex-core"
  | "known-publisher"
  | "ror-affiliation";

const ALLOW_LIST_SIGNALS: readonly SignalDefinition[] = [
  { id: "doaj", label: "Directory of Open Access Journals", positiveContribution: 8 },
  { id: "medline", label: "MEDLINE indexed", positiveContribution: 8 },
  { id: "openalex-core", label: "OpenAlex core source", positiveContribution: 5 },
  { id: "known-publisher", label: "Known publisher allow-list", positiveContribution: 4 },
  { id: "ror-affiliation", label: "ROR affiliation", positiveContribution: 4 },
];

function signal(
  id: CredibilitySignalId,
  label: string,
  polarity: SignalPolarity,
  evidence: string,
  source: string,
  license: string,
  contribution?: number,
): CredibilitySignal {
  return {
    id,
    version: CREDIBILITY_POLICY_VERSION,
    label,
    polarity,
    evidence,
    source,
    license,
    ...(contribution === undefined ? {} : { contribution }),
  };
}

function unknownSignal(id: CredibilitySignalId, label: string): CredibilitySignal {
  return signal(
    id,
    label,
    "neutral",
    "Not checked or no result supplied; no credibility inference made.",
    UNKNOWN_SOURCE,
    UNKNOWN_LICENSE,
  );
}

function allowListSignal(
  definition: SignalDefinition,
  lookup: AuthorityLookup | undefined,
): CredibilitySignal {
  if (!lookup || lookup.matched === null) {
    return unknownSignal(definition.id, definition.label);
  }
  if (!lookup.matched) {
    return signal(
      definition.id,
      definition.label,
      "neutral",
      `${lookup.evidence} No allow-list match; this is not evidence of low credibility.`,
      lookup.source,
      lookup.license,
    );
  }
  return signal(
    definition.id,
    definition.label,
    "positive",
    lookup.evidence,
    lookup.source,
    lookup.license,
    definition.positiveContribution,
  );
}

function doiSignal(
  id: "doi-registered" | "doi-resolving",
  label: string,
  lookup: AuthorityLookup | undefined,
  positiveContribution: number,
  cautionContribution: number,
): CredibilitySignal {
  if (!lookup || lookup.matched === null) return unknownSignal(id, label);
  return lookup.matched
    ? signal(
        id,
        label,
        "positive",
        lookup.evidence,
        lookup.source,
        lookup.license,
        positiveContribution,
      )
    : signal(
        id,
        label,
        "caution",
        lookup.evidence,
        lookup.source,
        lookup.license,
        cautionContribution,
      );
}

function eventSignal(
  id: CredibilitySignalId,
  label: string,
  lookup: AuthorityLookup | undefined,
  matchedPolarity: SignalPolarity,
  matchedContribution: number,
): CredibilitySignal {
  if (!lookup || lookup.matched === null) return unknownSignal(id, label);
  if (!lookup.matched) {
    return signal(
      id,
      label,
      "neutral",
      `${lookup.evidence} No matching event found; coverage may be incomplete.`,
      lookup.source,
      lookup.license,
    );
  }
  return signal(
    id,
    label,
    matchedPolarity,
    lookup.evidence,
    lookup.source,
    lookup.license,
    matchedContribution,
  );
}

function openAccessSignal(work: CredibilityWork): CredibilitySignal {
  const status = work.oaStatus?.trim();
  if (!status) return unknownSignal("open-access", "Open access status");
  const isOpen = ["open", "gold", "green", "hybrid", "bronze"].includes(status.toLowerCase());
  return signal(
    "open-access",
    "Open access status",
    isOpen ? "positive" : "neutral",
    isOpen
      ? `Normalized open-access status: ${status}.`
      : `Status "${status}" is not treated as evidence for or against credibility.`,
    METADATA_SOURCE,
    METADATA_LICENSE,
    isOpen ? 2 : undefined,
  );
}

function licenseSignal(work: CredibilityWork): CredibilitySignal {
  const publicationLicense = work.license?.trim();
  if (!publicationLicense) return unknownSignal("license", "Publication license");
  return signal(
    "license",
    "Publication license",
    "positive",
    `A publication license was supplied: ${publicationLicense}. Presence improves reuse transparency, not research validity.`,
    METADATA_SOURCE,
    METADATA_LICENSE,
    2,
  );
}

function versionSignal(work: CredibilityWork): CredibilitySignal {
  const version = work.version ?? "unknown";
  switch (version) {
    case "preprint":
      return signal(
        "publication-version",
        "Publication version",
        "caution",
        "Identified as a preprint; peer review and later versions may change the record.",
        METADATA_SOURCE,
        METADATA_LICENSE,
        -4,
      );
    case "version-of-record":
      return signal(
        "publication-version",
        "Publication version",
        "positive",
        "Identified as the version of record.",
        METADATA_SOURCE,
        METADATA_LICENSE,
        3,
      );
    case "other":
      return signal(
        "publication-version",
        "Publication version",
        "neutral",
        "A publication version was supplied but is not scored.",
        METADATA_SOURCE,
        METADATA_LICENSE,
      );
    case "unknown":
      return unknownSignal("publication-version", "Publication version");
    default: {
      const exhaustive: never = version;
      return exhaustive;
    }
  }
}

function metadataSignal(work: CredibilityWork): CredibilitySignal {
  const checks = [
    Boolean(work.title?.trim()),
    Boolean(work.authors?.some((author) => author.trim().length > 0)),
    Boolean(work.publishedDate?.trim()),
    Boolean(work.doi?.trim() || work.canonicalUrl?.trim()),
    Boolean(work.publisher?.trim()),
    Boolean(work.version && work.version !== "unknown"),
  ];
  const present = checks.filter(Boolean).length;
  const ratio = present / checks.length;
  if (ratio === 1) {
    return signal(
      "metadata-completeness",
      "Metadata completeness",
      "positive",
      "All 6 scored descriptive metadata groups are present.",
      METADATA_SOURCE,
      METADATA_LICENSE,
      4,
    );
  }
  if (ratio >= 0.5) {
    return signal(
      "metadata-completeness",
      "Metadata completeness",
      "caution",
      `${present} of 6 scored descriptive metadata groups are present; missing fields increase uncertainty.`,
      METADATA_SOURCE,
      METADATA_LICENSE,
      -2,
    );
  }
  return signal(
    "metadata-completeness",
    "Metadata completeness",
    "caution",
    `${present} of 6 scored descriptive metadata groups are present; identification is substantially uncertain.`,
    METADATA_SOURCE,
    METADATA_LICENSE,
    -6,
  );
}

function scoreBand(score: number): CredibilityBand {
  if (score < 30) return "serious-concern";
  if (score < 50) return "limited-evidence";
  if (score < 70) return "uncertain";
  if (score < 85) return "supported";
  return "strongly-supported";
}

function lookupFor(
  id: SignalDefinition["id"],
  lookups: AuthorityLookups,
): AuthorityLookup | undefined {
  switch (id) {
    case "doaj":
      return lookups.doaj;
    case "medline":
      return lookups.medline;
    case "openalex-core":
      return lookups.openAlexCore;
    case "known-publisher":
      return lookups.knownPublisher;
    case "ror-affiliation":
      return lookups.rorAffiliation;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

function authorityUncertainty(lookups: AuthorityLookups): string[] {
  const missing: string[] = [];
  const candidates: ReadonlyArray<[string, AuthorityLookup | undefined]> = [
    ["DOI registration", lookups.doiRegistered],
    ["DOI resolution", lookups.doiResolves],
    ["DOAJ", lookups.doaj],
    ["MEDLINE", lookups.medline],
    ["OpenAlex core", lookups.openAlexCore],
    ["publisher allow-list", lookups.knownPublisher],
    ["ROR affiliation", lookups.rorAffiliation],
    ["Retraction Watch retraction", lookups.retractionWatch?.retraction],
    ["Retraction Watch expression of concern", lookups.retractionWatch?.expressionOfConcern],
    ["Retraction Watch correction", lookups.retractionWatch?.correction],
    ["Retraction Watch reinstatement", lookups.retractionWatch?.reinstatement],
  ];
  for (const [label, lookup] of candidates) {
    if (!lookup || lookup.matched === null) missing.push(`${label} was not checked or was indeterminate.`);
  }
  return missing;
}

/**
 * Scores supplied facts only. It performs no I/O and never infers a negative
 * reputation from an absent allow-list match.
 */
export function scoreCredibility(
  work: CredibilityWork,
  lookups: AuthorityLookups = {},
): CredibilityResult {
  const signals: CredibilitySignal[] = [
    doiSignal("doi-registered", "DOI registered", lookups.doiRegistered, 5, -2),
    doiSignal("doi-resolving", "DOI resolves", lookups.doiResolves, 5, -3),
    ...ALLOW_LIST_SIGNALS.map((definition) =>
      allowListSignal(definition, lookupFor(definition.id, lookups)),
    ),
    eventSignal(
      "retraction-watch-retraction",
      "Retraction Watch retraction",
      lookups.retractionWatch?.retraction,
      "negative",
      -35,
    ),
    eventSignal(
      "retraction-watch-expression-of-concern",
      "Retraction Watch expression of concern",
      lookups.retractionWatch?.expressionOfConcern,
      "negative",
      -18,
    ),
    eventSignal(
      "retraction-watch-correction",
      "Retraction Watch correction",
      lookups.retractionWatch?.correction,
      "caution",
      -6,
    ),
    eventSignal(
      "retraction-watch-reinstatement",
      "Retraction Watch reinstatement",
      lookups.retractionWatch?.reinstatement,
      "positive",
      30,
    ),
    openAccessSignal(work),
    licenseSignal(work),
    versionSignal(work),
    metadataSignal(work),
  ];
  const rawScore = signals.reduce(
    (total, item) => total + (item.contribution ?? 0),
    BASE_SCORE,
  );
  const score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, rawScore));
  const uncertainty = authorityUncertainty(lookups);
  if (!work.version || work.version === "unknown") {
    uncertainty.push("Publication version is unknown.");
  }
  if (!work.license?.trim()) {
    uncertainty.push("Publication license is unknown.");
  }

  return {
    policyVersion: CREDIBILITY_POLICY_VERSION,
    score,
    band: scoreBand(score),
    signals,
    uncertainty,
  };
}
