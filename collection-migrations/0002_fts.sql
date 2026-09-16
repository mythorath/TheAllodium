-- Full rebuild of FTS5 on every import. No incremental triggers.
-- Run after entries + entry_search_documents are loaded.

DROP TABLE IF EXISTS entry_fts;

CREATE VIRTUAL TABLE entry_fts USING fts5(
  entry_id UNINDEXED,
  title,
  meta,
  abstract_text,
  tokenize = 'porter unicode61'
);

INSERT INTO entry_fts (entry_id, title, meta, abstract_text)
SELECT
  entry_id,
  title,
  meta,
  CASE
    WHEN (SELECT abstract_search_enabled FROM snapshot_manifest WHERE id = 1) = 1
      THEN COALESCE(abstract_text, '')
    ELSE ''
  END
FROM entry_search_documents;
