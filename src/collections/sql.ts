import { createHash } from "node:crypto";
import {
  V2_ALLOWED_ENTRY_FIELDS,
  V2_FORBIDDEN_FIELDS,
} from "./contract-v2";

export type SqlValue = string | number | null;

export type ParsedInsert = {
  table: string;
  columns: string[];
  rows: SqlValue[][];
};

export function parseSqlLiteral(raw: string | undefined): SqlValue {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "NULL") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function splitTopLevelSqlValues(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (inner[i + 1] === "'") {
          current += "'";
          i += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

export function parseInserts(sql: string): ParsedInsert[] {
  const inserts: ParsedInsert[] = [];
  const headerRe = /INSERT\s+INTO\s+([a-z_]+)\s*\(([^)]+)\)\s*VALUES/gi;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(sql)) !== null) {
    const table = match[1];
    const columns = match[2].split(",").map((column) => column.trim());
    let i = match.index + match[0].length;
    const rows: SqlValue[][] = [];
    while (i < sql.length) {
      while (i < sql.length && /[\s,]/.test(sql[i]!)) i += 1;
      if (sql[i] === ";") {
        i += 1;
        break;
      }
      if (sql[i] !== "(") break;
      const tupleStart = i + 1;
      let depth = 1;
      let inString = false;
      let j = tupleStart;
      while (j < sql.length && depth > 0) {
        const ch = sql[j];
        if (inString) {
          if (ch === "'") {
            if (sql[j + 1] === "'") {
              j += 2;
              continue;
            }
            inString = false;
          }
          j += 1;
          continue;
        }
        if (ch === "'") {
          inString = true;
          j += 1;
          continue;
        }
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        j += 1;
      }
      const fields = splitTopLevelSqlValues(sql.slice(tupleStart, j - 1)).map(parseSqlLiteral);
      rows.push(fields);
      i = j;
    }
    inserts.push({ table, columns, rows });
    headerRe.lastIndex = i;
  }
  return inserts;
}

export function rowsAsObjects(
  insert: ParsedInsert,
): Array<Record<string, SqlValue>> {
  return insert.rows.map((row) => {
    const object: Record<string, SqlValue> = {};
    insert.columns.forEach((column, index) => {
      object[column] = row[index] ?? null;
    });
    return object;
  });
}

const FORBIDDEN_PATH_MARKERS = ["/tank/", "/home/", "acbs-member-personal-use"];

export function assertV2SnapshotSql(sql: string): void {
  const inserts = parseInserts(sql);
  const entries = inserts.filter((item) => item.table === "entries");
  const manifests = inserts.filter((item) => item.table === "snapshot_manifest");
  if (manifests.length === 0) {
    throw new Error("Snapshot SQL has no INSERT INTO snapshot_manifest");
  }
  for (const insert of manifests) {
    for (const row of rowsAsObjects(insert)) {
      if (String(row.contract_version) !== "2") {
        throw new Error("snapshot_manifest.contract_version must be 2");
      }
      if (String(row.schema_version) !== "1") {
        throw new Error("snapshot_manifest.schema_version must be 1");
      }
      if ((V2_FORBIDDEN_FIELDS as readonly string[]).some((field) => field in row && row[field] != null)) {
        throw new Error("snapshot_manifest contains a forbidden field");
      }
    }
  }
  if (entries.length === 0) {
    throw new Error("Snapshot SQL has no INSERT INTO entries");
  }
    for (const insert of entries) {
      for (const column of insert.columns) {
        if ((V2_FORBIDDEN_FIELDS as readonly string[]).includes(column)) {
          throw new Error(`Forbidden column in entries INSERT: ${column}`);
        }
      }
      for (const required of ["id", "title", "resource_type", "canonical_url", "link_status"] as const) {
        if (!insert.columns.includes(required)) {
          throw new Error(`entries INSERT missing required column: ${required}`);
        }
      }
    for (const row of rowsAsObjects(insert)) {
      for (const [field, value] of Object.entries(row)) {
        if (!(V2_ALLOWED_ENTRY_FIELDS as readonly string[]).includes(field)) {
          throw new Error(`Unknown entries column: ${field}`);
        }
        if (typeof value === "string") {
          for (const marker of FORBIDDEN_PATH_MARKERS) {
            if (value.includes(marker)) {
              throw new Error(`Forbidden substring ${marker} in ${field}`);
            }
          }
        }
      }
    }
  }
}

export type SnapshotTables = {
  entries: Array<Record<string, SqlValue>>;
  tags: Array<Record<string, SqlValue>>;
  entry_tags: Array<Record<string, SqlValue>>;
  verifications: Array<Record<string, SqlValue>>;
  aliases: Array<Record<string, SqlValue>>;
  search_documents: Array<Record<string, SqlValue>>;
  neighbors: Array<Record<string, SqlValue>>;
};

export function parseSnapshotTables(sql: string): SnapshotTables {
  const inserts = parseInserts(sql);
  const collect = (table: string) =>
    inserts.filter((item) => item.table === table).flatMap(rowsAsObjects);
  return {
    entries: collect("entries"),
    tags: collect("tags"),
    entry_tags: collect("entry_tags"),
    verifications: collect("entry_verifications"),
    aliases: collect("entry_aliases"),
    search_documents: collect("entry_search_documents"),
    neighbors: collect("entry_neighbors"),
  };
}

export function assertSnapshotReferentialIntegrity(sql: string): void {
  const tables = parseSnapshotTables(sql);
  const entryIds = new Set(tables.entries.map((row) => String(row.id)));
  if (entryIds.size !== tables.entries.length) {
    throw new Error("Duplicate entry ids");
  }
  const tagIds = new Set(tables.tags.map((row) => String(row.id)));
  for (const row of tables.entry_tags) {
    if (!entryIds.has(String(row.entry_id))) {
      throw new Error(`entry_tags references missing entry ${row.entry_id}`);
    }
    if (!tagIds.has(String(row.tag_id))) {
      throw new Error(`entry_tags references missing tag ${row.tag_id}`);
    }
  }
  for (const row of tables.verifications) {
    if (!entryIds.has(String(row.entry_id))) {
      throw new Error(`verification references missing entry ${row.entry_id}`);
    }
  }
  for (const row of tables.aliases) {
    if (!entryIds.has(String(row.canonical_id))) {
      throw new Error(`alias references missing entry ${row.canonical_id}`);
    }
  }
  for (const row of tables.search_documents) {
    if (!entryIds.has(String(row.entry_id))) {
      throw new Error(`search document references missing entry ${row.entry_id}`);
    }
  }
  for (const row of tables.neighbors) {
    if (!entryIds.has(String(row.entry_id)) || !entryIds.has(String(row.neighbor_id))) {
      throw new Error("neighbor references a missing entry");
    }
  }
}

export function computeRowSetChecksum(sql: string): string {
  const tables = parseSnapshotTables(sql);
  const payload = {
    entries: tables.entries,
    tags: [...tables.tags].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    entry_tags: [...tables.entry_tags].sort((a, b) =>
      `${a.entry_id}:${a.tag_id}`.localeCompare(`${b.entry_id}:${b.tag_id}`),
    ),
    verifications: [...tables.verifications].sort((a, b) =>
      `${a.entry_id}:${a.check_kind}`.localeCompare(`${b.entry_id}:${b.check_kind}`),
    ),
    aliases: tables.aliases,
    search_documents: [...tables.search_documents].sort((a, b) =>
      String(a.entry_id).localeCompare(String(b.entry_id)),
    ),
    neighbors: [...tables.neighbors].sort((a, b) =>
      `${a.entry_id}:${a.rank}`.localeCompare(`${b.entry_id}:${b.rank}`),
    ),
  };
  const blob = JSON.stringify(payload);
  return createHash("sha256").update(blob).digest("hex");
}

export function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
