PRAGMA foreign_keys = ON;

INSERT INTO authority_manifest (
  family, snapshot_id, schema_version, source_name, source_url, license_name, license_url,
  fetched_at, source_checksum_sha256, row_count, metadata_json, imported_at
) VALUES
  ('openalex', 'browse-fixture', 1, 'OpenAlex', 'https://openalex.org/data-dump', 'CC0 1.0',
   'https://creativecommons.org/publicdomain/zero/1.0/', '2026-09-01T00:00:00Z',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10, '{}', '2026-09-01T00:00:00Z'),
  ('ror', 'browse-fixture', 1, 'ROR', 'https://ror.org/data/', 'CC0 1.0',
   'https://creativecommons.org/publicdomain/zero/1.0/', '2026-09-01T00:00:00Z',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, '{}', '2026-09-01T00:00:00Z'),
  ('retraction_watch', 'browse-fixture', 1, 'Retraction Watch', 'https://example.test/rw', 'CC BY 4.0',
   'https://creativecommons.org/licenses/by/4.0/', '2026-09-01T00:00:00Z',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1, '{}', '2026-09-01T00:00:00Z'),
  ('doaj', 'browse-fixture', 1, 'DOAJ', 'https://doaj.org/csv', 'CC0 1.0',
   'https://creativecommons.org/publicdomain/zero/1.0/', '2026-09-01T00:00:00Z',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 1, '{}', '2026-09-01T00:00:00Z'),
  ('nlm', 'browse-fixture', 1, 'NLM Catalog', 'https://www.nlm.nih.gov/databases/download/', 'NLM data terms',
   'https://www.nlm.nih.gov/databases/download/terms_and_conditions.html', '2026-09-01T00:00:00Z',
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 1, '{}', '2026-09-01T00:00:00Z');

INSERT INTO oa_publishers (
  id, display_name, alternate_titles_json, country_codes_json, hierarchy_level,
  parent_publisher_id, works_count, cited_by_count, source_family
) VALUES
  ('P1', 'Example Press', '[]', '["US"]', 0, NULL, 1000, 2000, 'openalex'),
  ('P2', 'Example Press Journals', '[]', '["US"]', 1, 'P1', 400, 800, 'openalex');

INSERT INTO oa_sources (
  id, display_name, issn_l, issns_json, host_organization_id, publisher_id, source_type,
  is_oa, is_in_doaj, works_count, cited_by_count, homepage_url, source_family
) VALUES
  ('S1', 'Example Journal', '1234-5678', '["1234-5678"]', NULL, 'P1', 'journal', 1, 1, 250, 500,
   'https://example.test/journal', 'openalex'),
  ('S2', 'Example Conference', NULL, '[]', NULL, NULL, 'conference', 0, 0, 40, 10, NULL, 'openalex');

INSERT INTO oa_source_issns (source_id, issn) VALUES ('S1', '1234-5678');

INSERT INTO oa_domains (id, display_name, description, works_count, cited_by_count, source_family) VALUES
  ('D1', 'Health Sciences', 'Health domain', 5000, 9000, 'openalex'),
  ('D2', 'Social Sciences', 'Social domain', 3000, 4000, 'openalex');

INSERT INTO oa_fields (id, domain_id, display_name, description, works_count, cited_by_count, source_family) VALUES
  ('FL1', 'D1', 'Psychology', 'Psychology field', 2000, 3500, 'openalex'),
  ('FL2', 'D2', 'Economics', 'Economics field', 1500, 2200, 'openalex');

INSERT INTO oa_subfields (id, field_id, display_name, description, works_count, cited_by_count, source_family) VALUES
  ('SF1', 'FL1', 'Clinical Psychology', 'Clinical subfield', 800, 1200, 'openalex'),
  ('SF2', 'FL2', 'Development', 'Development subfield', 600, 900, 'openalex');

INSERT INTO oa_topics (
  id, subfield_id, display_name, description, keywords_json, works_count, cited_by_count, source_family
) VALUES
  ('T1', 'SF1', 'Cognitive Behavioral Therapy', 'CBT topic', '["cognition","therapy"]', 120, 300, 'openalex'),
  ('T2', 'SF2', 'Behavioral Economics', 'BE topic', '["decision","therapy"]', 90, 210, 'openalex');

INSERT INTO oa_topic_keywords (keyword, topic_id) VALUES
  ('cognition', 'T1'),
  ('therapy', 'T1'),
  ('decision', 'T2'),
  ('therapy', 'T2');

INSERT INTO oa_institutions (
  id, ror_id, display_name, country_code, institution_type, parent_institution_id,
  works_count, cited_by_count, source_family
) VALUES
  ('I1', '01abcde12', 'Institute of Example', 'US', 'education', NULL, 700, 1100, 'openalex');

INSERT INTO ror_organizations (
  id, display_name, organization_types_json, country_code, status, established_year,
  website_url, aliases_json, labels_json, external_ids_json, source_family
) VALUES
  ('01abcde12', 'Institute of Example', '["Education"]', 'US', 'active', 1900,
   'https://example.test/institute', '[]', '[]', '{}', 'ror');

INSERT INTO retraction_watch_notices (
  id, doi, original_paper_doi, title, journal, publisher, notice_type, notice_date,
  original_paper_date, reason_json, source_family
) VALUES
  ('RW1', '10.1000/notice', '10.1000/example', 'Notice of retraction', 'Example Journal',
   'Example Press', 'Retraction', '2024-01-15', '2020-06-01', '["Error"]', 'retraction_watch');

INSERT INTO doaj_journals (
  id, title, issn, eissn, publisher, country_code, added_on, last_updated, seal,
  license_json, subjects_json, source_family
) VALUES
  ('J1', 'Example Journal', '1234-5678', NULL, 'Example Press', 'US', '2018-01-01', '2026-01-01',
   1, '["CC BY"]', '["Medicine","Psychology"]', 'doaj');

INSERT INTO doaj_journal_subjects (subject, doaj_id) VALUES
  ('Medicine', 'J1'),
  ('Psychology', 'J1');

INSERT INTO nlm_journals (
  nlm_id, title, abbreviation, issn_print, issn_electronic, issn_linking, publisher,
  country, language_json, medline_ta, source_family
) VALUES
  ('N1', 'Example Journal', 'Ex J', '1234-5678', NULL, '1234-5678', 'Example Press',
   'United States', '["eng"]', 'Ex J', 'nlm');

INSERT INTO hub_work_records (
  doi, title, authors_json, publication_year, publication_date, container_title,
  work_type, is_open_access, cited_by_count, canonical_url, openalex_id, fetched_at
) VALUES
  ('10.1000/example', 'Retracted example paper',
   '[{"name":"Ada Example","orcid":null}]', 2020, '2020-06-01', 'Example Journal',
   'article', 1, 42, 'https://doi.org/10.1000/example', 'https://openalex.org/W1',
   '2026-09-01T00:00:00Z'),
  ('10.1000/cited-ok', 'Most cited clinical paper',
   '[{"name":"Bea Cited","orcid":null}]', 2018, '2018-03-12', 'Example Journal',
   'article', 1, 99, 'https://doi.org/10.1000/cited-ok', 'https://openalex.org/W2',
   '2026-09-01T00:00:00Z'),
  ('10.1000/recent-ok', 'Recent clinical paper',
   '[{"name":"Cara Recent","orcid":null}]', 2026, '2026-08-01', 'Example Journal',
   'article', 0, 3, 'https://doi.org/10.1000/recent-ok', 'https://openalex.org/W3',
   '2026-09-01T00:00:00Z');

INSERT INTO hub_works (hub_kind, hub_id, rank_kind, rank, doi) VALUES
  ('domain', 'D1', 'cited', 1, '10.1000/cited-ok'),
  ('domain', 'D1', 'cited', 2, '10.1000/example'),
  ('domain', 'D1', 'recent', 1, '10.1000/recent-ok'),
  ('field', 'FL1', 'cited', 1, '10.1000/cited-ok'),
  ('field', 'FL1', 'recent', 1, '10.1000/recent-ok'),
  ('subfield', 'SF1', 'cited', 1, '10.1000/example'),
  ('subfield', 'SF1', 'cited', 2, '10.1000/cited-ok'),
  ('subfield', 'SF1', 'recent', 1, '10.1000/recent-ok'),
  ('topic', 'T1', 'cited', 1, '10.1000/example'),
  ('topic', 'T1', 'recent', 1, '10.1000/recent-ok');
