export type AuthorityFamily = "openalex" | "ror" | "retraction_watch" | "doaj" | "nlm";

export type AuthorityManifest = {
  family: AuthorityFamily;
  snapshotId: string;
  schemaVersion: number;
  sourceName: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  fetchedAt: string;
  sourceChecksumSha256: string;
  rowCount: number;
  metadata: Record<string, unknown>;
  importedAt: string;
};

export type AuthorityHealth = {
  healthy: boolean;
  expectedFamilies: AuthorityFamily[];
  missingFamilies: AuthorityFamily[];
  staleFamilies: AuthorityFamily[];
  manifests: AuthorityManifest[];
};

export type AuthorityVenue = {
  id: string;
  displayName: string;
  issnL: string | null;
  issns: string[];
  publisherId: string | null;
  sourceType: string | null;
  isOpenAccess: boolean | null;
  isInDoaj: boolean | null;
  worksCount: number | null;
  citedByCount: number | null;
  homepageUrl: string | null;
  doajListed: boolean;
  nlmId: string | null;
};

export type AuthorityPublisher = {
  id: string;
  displayName: string;
  alternateTitles: string[];
  countryCodes: string[];
  hierarchyLevel: number | null;
  parentPublisherId: string | null;
  worksCount: number | null;
  citedByCount: number | null;
};

export type AuthorityInstitution = {
  openAlexId: string | null;
  rorId: string | null;
  displayName: string;
  countryCode: string | null;
  institutionType: string | null;
  organizationTypes: string[];
  status: string | null;
  websiteUrl: string | null;
};

export type RetractionNotice = {
  id: string;
  doi: string | null;
  originalPaperDoi: string | null;
  title: string;
  journal: string | null;
  publisher: string | null;
  noticeType: string;
  noticeDate: string | null;
  reasons: string[];
};

export type TaxonomyTopic = {
  id: string;
  displayName: string;
  description: string | null;
  keywords: string[];
  worksCount: number | null;
  citedByCount: number | null;
};

export type TaxonomySubfield = {
  id: string;
  displayName: string;
  description: string | null;
  worksCount: number | null;
  citedByCount: number | null;
  topics: TaxonomyTopic[];
};

export type TaxonomyField = {
  id: string;
  displayName: string;
  description: string | null;
  worksCount: number | null;
  citedByCount: number | null;
  subfields: TaxonomySubfield[];
};

export type TaxonomyDomain = {
  id: string;
  displayName: string;
  description: string | null;
  worksCount: number | null;
  citedByCount: number | null;
  fields: TaxonomyField[];
};
