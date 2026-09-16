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

export type BrowseCursor = {
  name: string;
  id: string;
};

export type BrowsePage<T> = {
  items: T[];
  nextAfter: string | null;
};

export type NamedCount = {
  name: string;
  count: number;
};

export type VenueSummary = {
  id: string;
  displayName: string;
  sourceType: string | null;
  worksCount: number | null;
};

export type PublisherSummary = {
  id: string;
  displayName: string;
  worksCount: number | null;
  parentPublisherId: string | null;
};

export type OrganizationSummary = {
  rorId: string;
  displayName: string;
  countryCode: string | null;
  organizationTypes: string[];
};

export type KeywordTopic = {
  id: string;
  displayName: string;
  domainId: string;
  domainName: string;
  fieldId: string;
  fieldName: string;
  subfieldId: string;
  subfieldName: string;
  worksCount: number | null;
};

export type SubjectSummary = {
  subject: string;
  journalCount: number;
};

export type IssnResolution = {
  issn: string;
  doajId: string | null;
  doajTitle: string | null;
  nlmId: string | null;
  nlmTitle: string | null;
};

export type DoajSubjectLink = {
  subject: string;
};

export type FieldPath = {
  domain: TaxonomyDomain;
  field: TaxonomyField;
};

export type SubfieldPath = FieldPath & {
  subfield: TaxonomySubfield;
};

export type TopicPath = SubfieldPath & {
  topic: TaxonomyTopic;
  siblings: TaxonomyTopic[];
};

export type FederatedWorkOverview = {
  doi: string;
  overview: string;
  model: string;
  generatedAt: string;
  sourceNote: string | null;
};

export type HubKind = "domain" | "field" | "subfield" | "topic";

export type RankKind = "cited" | "recent";

export type HubWorkAuthor = {
  name: string;
  orcid: string | null;
};

export type HubWork = {
  doi: string;
  title: string;
  authors: HubWorkAuthor[];
  publicationYear: number | null;
  publicationDate: string | null;
  containerTitle: string | null;
  workType: string | null;
  isOpenAccess: boolean | null;
  citedByCount: number | null;
  canonicalUrl: string | null;
  openalexId: string | null;
  fetchedAt: string;
  rank: number;
  rankKind: RankKind;
  retracted: boolean;
};

export type HubWorksByRank = {
  cited: HubWork[];
  recent: HubWork[];
};

export type SitemapKind =
  | "static"
  | "fields"
  | "keywords"
  | "venues"
  | "publishers"
  | "organizations"
  | "subjects"
  | "retractions"
  | "entries";
