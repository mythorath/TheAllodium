-- Phase 5B authority data. Kept separate from the application migrations so
-- authority snapshots can be built and promoted independently.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS authority_manifest (
  family TEXT PRIMARY KEY CHECK (family IN (
    'openalex', 'ror', 'retraction_watch', 'doaj', 'nlm'
  )),
  snapshot_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_checksum_sha256 TEXT NOT NULL CHECK (length(source_checksum_sha256) = 64),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_authority_manifest_snapshot
  ON authority_manifest(snapshot_id);

CREATE TABLE IF NOT EXISTS oa_publishers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  alternate_titles_json TEXT NOT NULL DEFAULT '[]',
  country_codes_json TEXT NOT NULL DEFAULT '[]',
  hierarchy_level INTEGER,
  parent_publisher_id TEXT,
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_oa_publishers_name ON oa_publishers(display_name);
CREATE INDEX IF NOT EXISTS idx_oa_publishers_parent ON oa_publishers(parent_publisher_id);

CREATE TABLE IF NOT EXISTS oa_sources (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  issn_l TEXT,
  issns_json TEXT NOT NULL DEFAULT '[]',
  host_organization_id TEXT,
  publisher_id TEXT,
  source_type TEXT,
  is_oa INTEGER CHECK (is_oa IN (0, 1)),
  is_in_doaj INTEGER CHECK (is_in_doaj IN (0, 1)),
  works_count INTEGER,
  cited_by_count INTEGER,
  homepage_url TEXT,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family),
  FOREIGN KEY (publisher_id) REFERENCES oa_publishers(id)
);
CREATE INDEX IF NOT EXISTS idx_oa_sources_issn_l ON oa_sources(issn_l);
CREATE INDEX IF NOT EXISTS idx_oa_sources_publisher ON oa_sources(publisher_id);
CREATE INDEX IF NOT EXISTS idx_oa_sources_host_org ON oa_sources(host_organization_id);

CREATE TABLE IF NOT EXISTS oa_source_issns (
  source_id TEXT NOT NULL,
  issn TEXT NOT NULL,
  PRIMARY KEY (source_id, issn),
  FOREIGN KEY (source_id) REFERENCES oa_sources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oa_source_issns_issn ON oa_source_issns(issn);

CREATE TABLE IF NOT EXISTS oa_institutions (
  id TEXT PRIMARY KEY,
  ror_id TEXT,
  display_name TEXT NOT NULL,
  country_code TEXT,
  institution_type TEXT,
  parent_institution_id TEXT,
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oa_institutions_ror
  ON oa_institutions(ror_id) WHERE ror_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oa_institutions_name ON oa_institutions(display_name);

CREATE TABLE IF NOT EXISTS oa_funders (
  id TEXT PRIMARY KEY,
  ror_id TEXT,
  display_name TEXT NOT NULL,
  alternate_titles_json TEXT NOT NULL DEFAULT '[]',
  country_code TEXT,
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_oa_funders_ror ON oa_funders(ror_id);
CREATE INDEX IF NOT EXISTS idx_oa_funders_name ON oa_funders(display_name);

CREATE TABLE IF NOT EXISTS oa_domains (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);

CREATE TABLE IF NOT EXISTS oa_fields (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (domain_id) REFERENCES oa_domains(id),
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_oa_fields_domain ON oa_fields(domain_id);

CREATE TABLE IF NOT EXISTS oa_subfields (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (field_id) REFERENCES oa_fields(id),
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_oa_subfields_field ON oa_subfields(field_id);

CREATE TABLE IF NOT EXISTS oa_topics (
  id TEXT PRIMARY KEY,
  subfield_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  works_count INTEGER,
  cited_by_count INTEGER,
  source_family TEXT NOT NULL DEFAULT 'openalex',
  FOREIGN KEY (subfield_id) REFERENCES oa_subfields(id),
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_oa_topics_subfield ON oa_topics(subfield_id);
CREATE INDEX IF NOT EXISTS idx_oa_topics_name ON oa_topics(display_name);

CREATE TABLE IF NOT EXISTS ror_organizations (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  organization_types_json TEXT NOT NULL DEFAULT '[]',
  country_code TEXT,
  status TEXT,
  established_year INTEGER,
  website_url TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  external_ids_json TEXT NOT NULL DEFAULT '{}',
  source_family TEXT NOT NULL DEFAULT 'ror',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_ror_organizations_name ON ror_organizations(display_name);
CREATE INDEX IF NOT EXISTS idx_ror_organizations_country ON ror_organizations(country_code);

CREATE TABLE IF NOT EXISTS retraction_watch_notices (
  id TEXT PRIMARY KEY,
  doi TEXT,
  original_paper_doi TEXT,
  title TEXT NOT NULL,
  journal TEXT,
  publisher TEXT,
  notice_type TEXT NOT NULL,
  notice_date TEXT,
  original_paper_date TEXT,
  reason_json TEXT NOT NULL DEFAULT '[]',
  source_family TEXT NOT NULL DEFAULT 'retraction_watch',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_rw_notices_doi ON retraction_watch_notices(doi);
CREATE INDEX IF NOT EXISTS idx_rw_notices_original_doi
  ON retraction_watch_notices(original_paper_doi);
CREATE INDEX IF NOT EXISTS idx_rw_notices_date ON retraction_watch_notices(notice_date);

CREATE TABLE IF NOT EXISTS doaj_journals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  issn TEXT,
  eissn TEXT,
  publisher TEXT,
  country_code TEXT,
  added_on TEXT,
  last_updated TEXT,
  seal INTEGER NOT NULL DEFAULT 0 CHECK (seal IN (0, 1)),
  license_json TEXT NOT NULL DEFAULT '[]',
  subjects_json TEXT NOT NULL DEFAULT '[]',
  source_family TEXT NOT NULL DEFAULT 'doaj',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_doaj_journals_issn ON doaj_journals(issn);
CREATE INDEX IF NOT EXISTS idx_doaj_journals_eissn ON doaj_journals(eissn);
CREATE INDEX IF NOT EXISTS idx_doaj_journals_publisher ON doaj_journals(publisher);

CREATE TABLE IF NOT EXISTS nlm_journals (
  nlm_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  abbreviation TEXT,
  issn_print TEXT,
  issn_electronic TEXT,
  issn_linking TEXT,
  publisher TEXT,
  country TEXT,
  language_json TEXT NOT NULL DEFAULT '[]',
  medline_ta TEXT,
  source_family TEXT NOT NULL DEFAULT 'nlm',
  FOREIGN KEY (source_family) REFERENCES authority_manifest(family)
);
CREATE INDEX IF NOT EXISTS idx_nlm_journals_issn_print ON nlm_journals(issn_print);
CREATE INDEX IF NOT EXISTS idx_nlm_journals_issn_electronic ON nlm_journals(issn_electronic);
CREATE INDEX IF NOT EXISTS idx_nlm_journals_issn_linking ON nlm_journals(issn_linking);
