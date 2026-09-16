-- Phase 2A: contract v1.1, audience, structured authors, precomputed
-- nearest-neighbor pairs for the related-entries feature (2C). Migrations
-- are append-only: 0001/0002/0003 already applied to real staging/production
-- D1 stay untouched.

ALTER TABLE entries ADD COLUMN audience TEXT NOT NULL DEFAULT 'unknown'
  CHECK (audience IN ('client', 'clinician', 'unknown'));

-- Structured OpenAlex author list (JSON array), papers only. NULL for
-- entries with no bibliographic author data. The existing `author` column
-- remains the plain display string used everywhere today.
ALTER TABLE entries ADD COLUMN authors_json TEXT;

-- Precomputed cosine-kNN over backend/data/embeddings.npy, rebuilt fully on
-- every snapshot import alongside the other content tables (see
-- fixtures/reset_content_tables.sql). Not consumed by any route until
-- Phase 2C.
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
