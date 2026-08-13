-- Search result sorting by published_date, citation_count, and title.
-- Migrations are append-only: 0001–0005 already applied to real
-- staging/production D1 stay untouched.
--
-- Facet indexes already cover therapy_modality / audience / oa_status /
-- is_link_only / link_status. These three columns are the ones the new
-- `?sort=` options order by at corpus scale.

CREATE INDEX IF NOT EXISTS idx_entries_published_date ON entries(published_date);
CREATE INDEX IF NOT EXISTS idx_entries_citation_count ON entries(citation_count);
CREATE INDEX IF NOT EXISTS idx_entries_title ON entries(title);
