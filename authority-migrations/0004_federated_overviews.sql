-- Cached LLM overviews for federated /works pages. Generated offline;
-- the Worker only reads this table and never sees source abstracts.
-- Intentionally absent from snapshot DELETE_ORDER so authority promote
-- does not wipe months of GPU paraphrases.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS federated_work_overviews (
  doi TEXT PRIMARY KEY,
  overview TEXT NOT NULL CHECK (length(overview) > 0),
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_note TEXT
);
