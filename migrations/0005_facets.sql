-- Phase 2B: faceted browse and search over audience, therapy_modality,
-- oa_status, is_link_only, and link_status. Migrations are append-only:
-- 0001/0002/0003/0004 already applied to real staging/production D1 stay
-- untouched.
--
-- therapy_modality, oa_status, and link_status already have indexes from
-- 0001_schema.sql. audience (added in 0004) and is_link_only (present since
-- 0001 but never indexed) are the two facet dimensions still missing one.

CREATE INDEX IF NOT EXISTS idx_entries_audience ON entries(audience);
CREATE INDEX IF NOT EXISTS idx_entries_is_link_only ON entries(is_link_only);
