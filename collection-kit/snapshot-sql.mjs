/**
 * Dependency-free snapshot-SQL parsing shared by validate.mjs and
 * write-checksums.mjs. Mirrors the host's src/collections/sql.ts; the row
 * order and object key order here are what the row-set checksum hashes, so
 * the two implementations must stay byte-identical in their output.
 */
import { createHash } from "node:crypto";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseSqlLiteral(raw) {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "NULL") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Splits one row tuple on top-level commas, treating `'...'` (with `''` as
 * an escaped quote) as opaque so commas inside a title never split a field. */
export function splitTopLevel(inner) {
  const parts = [];
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

export function parseInserts(sql) {
  const inserts = [];
  const headerRe = /INSERT\s+INTO\s+([a-z_]+)\s*\(([^)]+)\)\s*VALUES/gi;
  let match;
  while ((match = headerRe.exec(sql)) !== null) {
    const table = match[1];
    const columns = match[2].split(",").map((column) => column.trim());
    let i = match.index + match[0].length;
    const rows = [];
    while (i < sql.length) {
      while (i < sql.length && /[\s,]/.test(sql[i])) i += 1;
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
      rows.push(splitTopLevel(sql.slice(tupleStart, j - 1)).map(parseSqlLiteral));
      i = j;
    }
    inserts.push({ table, columns, rows });
    headerRe.lastIndex = i;
  }
  return inserts;
}

export function rowsAsObjects(insert) {
  return insert.rows.map((row) => {
    const object = {};
    insert.columns.forEach((column, index) => {
      object[column] = row[index] ?? null;
    });
    return object;
  });
}

export function parseSnapshotTables(sql) {
  const inserts = parseInserts(sql);
  const collect = (table) =>
    inserts.filter((item) => item.table === table).flatMap(rowsAsObjects);
  return {
    inserts,
    entries: collect("entries"),
    tags: collect("tags"),
    entry_tags: collect("entry_tags"),
    verifications: collect("entry_verifications"),
    aliases: collect("entry_aliases"),
    search_documents: collect("entry_search_documents"),
    neighbors: collect("entry_neighbors"),
  };
}

export function computeRowSetChecksum(sql) {
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
  return sha256(JSON.stringify(payload));
}
