-- The Allodium public snapshot: minerals collection
-- Contract version: 2  Schema version: 1
-- Test-only example. Never deployed.

INSERT INTO snapshot_manifest (
  id, contract_version, schema_version, collection, source_generated_at,
  entry_count, tag_link_count, alias_count, checksum, abstract_search_enabled,
  exclusion_counts_json, coverage_json
) VALUES (
  1, '2', '1', 'minerals', '2026-09-16T00:00:00Z',
  2, 3, 0, '25e744fdf53bb056a96215611d03088b102bfb475d11d7cc39eb6d0b0eeec755', 0,
  '{}',
  '{"total_entries":2,"verifications":{"link":{"ok":2}},"link_status":{"ok":2},"identifiers":{"doi":2},"resource_types":{"paper":2}}'
);

INSERT INTO tags (id, name, category) VALUES
  (1, 'igneous', 'topic'),
  (2, 'paleozoic', 'era');

INSERT INTO entries (
  id, title, resource_type, source_org, canonical_url, author, published_date,
  credibility_tier, is_link_only, citation_count, oa_status, doi, pmid, pmcid,
  link_status, link_checked_at, updated_at, authors_json, overview
) VALUES
  (
    'aaaaaaaa00000001',
    'Basalt Column Primer',
    'paper',
    'USGS',
    'https://example.org/basalt',
    'Ada Stone',
    '2020-01-01',
    2, 0, 4, 'gold', '10.1000/example.basalt', NULL, NULL,
    'ok', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z',
    '[{"name":"Ada Stone","orcid":null,"institution":"USGS","position":"first"}]',
    'A short generated paraphrase of a public-domain primer on columnar basalt.'
  ),
  (
    'aaaaaaaa00000002',
    'Trilobite Locality Notes',
    'paper',
    'USGS',
    'https://example.org/trilobite',
    'Bea Flint',
    '2019-06-01',
    2, 0, 1, 'green', '10.1000/example.trilobite', NULL, NULL,
    'ok', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z',
    '[{"name":"Bea Flint","orcid":null,"institution":"USGS","position":"first"}]',
    'A short generated paraphrase of locality notes for Paleozoic trilobites.'
  );

INSERT INTO entry_tags (entry_id, tag_id) VALUES
  ('aaaaaaaa00000001', 1),
  ('aaaaaaaa00000002', 1),
  ('aaaaaaaa00000002', 2);

INSERT INTO entry_verifications (
  entry_id, check_kind, result, method, method_version, score, checked_at
) VALUES
  ('aaaaaaaa00000001', 'link', 'ok', 'http-check', '1', 1, '2026-09-16T00:00:00Z'),
  ('aaaaaaaa00000002', 'link', 'ok', 'http-check', '1', 1, '2026-09-16T00:00:00Z');

INSERT INTO entry_search_documents (entry_id, title, meta, abstract_text) VALUES
  ('aaaaaaaa00000001', 'Basalt Column Primer', 'Ada Stone USGS paper igneous', NULL),
  ('aaaaaaaa00000002', 'Trilobite Locality Notes', 'Bea Flint USGS paper igneous paleozoic', NULL);
