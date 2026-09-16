-- Precomputed OpenAlex works for taxonomy hub pages. Generated offline;
-- the Worker only reads these tables. No FKs, and intentionally absent
-- from snapshot DELETE_ORDER so authority promote does not wipe the
-- curated hub-work slice (same promotion-survival pattern as
-- federated_work_overviews).
-- Never store abstract_inverted_index or any abstract substitute.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS hub_work_records (
  doi TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  publication_year INTEGER,
  publication_date TEXT,
  container_title TEXT,
  work_type TEXT,
  is_open_access INTEGER CHECK (is_open_access IN (0, 1)),
  cited_by_count INTEGER,
  canonical_url TEXT,
  openalex_id TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_works (
  hub_kind TEXT NOT NULL CHECK (hub_kind IN ('domain', 'field', 'subfield', 'topic')),
  hub_id TEXT NOT NULL,
  rank_kind TEXT NOT NULL CHECK (rank_kind IN ('cited', 'recent')),
  rank INTEGER NOT NULL CHECK (rank >= 1),
  doi TEXT NOT NULL,
  PRIMARY KEY (hub_kind, hub_id, rank_kind, rank)
);
CREATE INDEX IF NOT EXISTS idx_hub_works_doi ON hub_works(doi);
