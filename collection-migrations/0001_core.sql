-- Collection module contract v1 / schema v1
-- Neutral curated-collection tables. Facets are tag categories, not
-- psychotherapy-specific columns. Psychotherapy keeps migrations/.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS snapshot_manifest (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  contract_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  collection TEXT NOT NULL,
  source_generated_at TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  tag_link_count INTEGER NOT NULL,
  alias_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  abstract_search_enabled INTEGER NOT NULL DEFAULT 0 CHECK (abstract_search_enabled IN (0, 1)),
  exclusion_counts_json TEXT NOT NULL DEFAULT '{}',
  coverage_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  source_org TEXT,
  canonical_url TEXT NOT NULL,
  author TEXT,
  published_date TEXT,
  credibility_tier INTEGER NOT NULL DEFAULT 2 CHECK (credibility_tier BETWEEN 1 AND 4),
  is_link_only INTEGER NOT NULL DEFAULT 0 CHECK (is_link_only IN (0, 1)),
  citation_count INTEGER,
  oa_status TEXT,
  doi TEXT,
  pmid TEXT,
  pmcid TEXT,
  link_status TEXT NOT NULL CHECK (link_status IN ('ok', 'blocked', 'unchecked')),
  link_checked_at TEXT,
  updated_at TEXT,
  authors_json TEXT,
  overview TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(resource_type);
CREATE INDEX IF NOT EXISTS idx_entries_link_status ON entries(link_status);
CREATE INDEX IF NOT EXISTS idx_entries_oa_status ON entries(oa_status);
CREATE INDEX IF NOT EXISTS idx_entries_doi ON entries(doi);
CREATE INDEX IF NOT EXISTS idx_entries_is_link_only ON entries(is_link_only);
CREATE INDEX IF NOT EXISTS idx_entries_published_date ON entries(published_date);
CREATE INDEX IF NOT EXISTS idx_entries_citation_count ON entries(citation_count);
CREATE INDEX IF NOT EXISTS idx_entries_title ON entries(title);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (entry_id, tag_id),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

CREATE TABLE IF NOT EXISTS entry_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  check_kind TEXT NOT NULL CHECK (check_kind IN ('identity', 'legitimacy', 'link')),
  result TEXT NOT NULL,
  method TEXT NOT NULL,
  method_version TEXT,
  score REAL,
  checked_at TEXT,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_verifications_entry ON entry_verifications(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_verifications_kind ON entry_verifications(check_kind);

CREATE TABLE IF NOT EXISTS entry_aliases (
  alias_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  FOREIGN KEY (canonical_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_aliases_canonical ON entry_aliases(canonical_id);

CREATE TABLE IF NOT EXISTS entry_search_documents (
  entry_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  abstract_text TEXT,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entry_neighbors (
  entry_id TEXT NOT NULL,
  neighbor_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (entry_id, rank),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (neighbor_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_neighbors_entry ON entry_neighbors(entry_id);
