-- Browse-graph indexes and derived lookup tables. Backfills from the live
-- snapshot so staging/production do not need a full re-promotion.
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_oa_sources_name ON oa_sources(display_name);
CREATE INDEX IF NOT EXISTS idx_oa_sources_type_name ON oa_sources(source_type, display_name);
CREATE INDEX IF NOT EXISTS idx_oa_institutions_country ON oa_institutions(country_code);
CREATE INDEX IF NOT EXISTS idx_rw_notices_journal ON retraction_watch_notices(journal);

CREATE TABLE IF NOT EXISTS oa_topic_keywords (
  keyword TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  PRIMARY KEY (keyword, topic_id),
  FOREIGN KEY (topic_id) REFERENCES oa_topics(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oa_topic_keywords_topic ON oa_topic_keywords(topic_id);

CREATE TABLE IF NOT EXISTS doaj_journal_subjects (
  subject TEXT NOT NULL,
  doaj_id TEXT NOT NULL,
  PRIMARY KEY (subject, doaj_id),
  FOREIGN KEY (doaj_id) REFERENCES doaj_journals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doaj_journal_subjects_doaj ON doaj_journal_subjects(doaj_id);

INSERT OR IGNORE INTO oa_topic_keywords (keyword, topic_id)
SELECT TRIM(j.value), t.id
FROM oa_topics t, json_each(t.keywords_json) j
WHERE typeof(j.value) IN ('text', 'integer', 'real')
  AND TRIM(j.value) != '';

INSERT OR IGNORE INTO doaj_journal_subjects (subject, doaj_id)
SELECT TRIM(j.value), d.id
FROM doaj_journals d, json_each(d.subjects_json) j
WHERE typeof(j.value) IN ('text', 'integer', 'real')
  AND TRIM(j.value) != '';
