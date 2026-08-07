-- Wipes all snapshot content tables before loading a new fixture/sample into
-- a persistent D1 (local reset uses `rm -rf .wrangler/state` instead; this
-- file exists only for the remote staging reload path, which cannot do
-- that). Order respects foreign keys: children before parents.
-- entry_fts is managed solely by migrations/0002_fts.sql (drop/create).

DELETE FROM entry_search_documents;
DELETE FROM entry_verifications;
DELETE FROM entry_aliases;
DELETE FROM entry_tags;
DELETE FROM tags;
DELETE FROM entries;
DELETE FROM snapshot_manifest;
