import authorityFixture from "../fixtures/authority_browse.sql?raw";
import { execStatements } from "./sql-test-utils";

const CLEAR_AUTHORITY_SQL = `
DELETE FROM federated_work_overviews;
DELETE FROM hub_works;
DELETE FROM hub_work_records;
DELETE FROM oa_topic_keywords;
DELETE FROM doaj_journal_subjects;
DELETE FROM oa_source_issns;
DELETE FROM oa_topics;
DELETE FROM oa_subfields;
DELETE FROM oa_fields;
DELETE FROM oa_domains;
DELETE FROM oa_sources;
DELETE FROM oa_institutions;
DELETE FROM oa_publishers;
DELETE FROM ror_organizations;
DELETE FROM retraction_watch_notices;
DELETE FROM doaj_journals;
DELETE FROM nlm_journals;
DELETE FROM authority_manifest;
`;

export async function clearAuthority(db: D1Database): Promise<void> {
  await execStatements(db, CLEAR_AUTHORITY_SQL);
}

export async function resetAuthority(db: D1Database): Promise<void> {
  await clearAuthority(db);
  await execStatements(db, authorityFixture);
}
