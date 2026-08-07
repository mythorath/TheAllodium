-- Phase 1D: /standard/'s coverage numbers (Phase 1E) must describe exactly
-- the deployed snapshot, not a newer ACT database, so they are computed once
-- at generation time and stored alongside the rest of the manifest.
-- Migrations are append-only: 0001/0002 already applied to real staging D1
-- stay untouched.

ALTER TABLE snapshot_manifest ADD COLUMN coverage_json TEXT NOT NULL DEFAULT '{}';
