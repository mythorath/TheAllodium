/** Pure parsing of generated snapshot SQL artifacts, enough of each
 * `INSERT INTO entries (...)` statement to recover id/title/canonical_url
 * for diff-snapshot-links.ts. Column order is taken from the INSERT header
 * so psychotherapy v1.2 and collection-module v2 snapshots both parse. */

import { parseInserts, rowsAsObjects } from "../src/collections/sql";

export interface SnapshotEntryLink {
  title: string;
  canonical_url: string;
}

export function parseEntryLinksFromSnapshotSql(sql: string): Map<string, SnapshotEntryLink> {
  const result = new Map<string, SnapshotEntryLink>();
  for (const insert of parseInserts(sql)) {
    if (insert.table !== "entries") continue;
    for (const row of rowsAsObjects(insert)) {
      const id = row.id;
      const title = row.title;
      const canonicalUrl = row.canonical_url;
      if (typeof id === "string" && typeof title === "string" && typeof canonicalUrl === "string") {
        result.set(id, { title, canonical_url: canonicalUrl });
      }
    }
  }
  return result;
}
