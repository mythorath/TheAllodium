/** Pure parsing of the generated `fixtures/*.sql` snapshot artifacts --
 * specifically just enough of the `entries` table's batched `INSERT`
 * statements to recover each id's `title`/`canonical_url`, for
 * diff-snapshot-links.ts's cross-promotion stability check. Deliberately a
 * character scanner rather than a line-anchored regex (unlike the earlier
 * ad hoc analysis this was built from): a row tuple is not guaranteed to
 * stay on one physical line if a title/overview field ever contains a
 * literal newline, so this tracks quote state and paren depth explicitly,
 * the same way tests/sql-test-utils.ts's splitSql() does at the
 * whole-statement level. */

export interface SnapshotEntryLink {
  title: string;
  canonical_url: string;
}

// Matches the fixed column order both export_allodium_snapshot.py and
// src/db/repository.ts agree on -- id, title, ..., canonical_url are always
// the first six columns.
const ENTRIES_HEADER =
  "INSERT INTO entries (id, title, resource_type, therapy_modality, source_org, canonical_url,";

function parseSqlLiteral(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "NULL") return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Splits one row tuple's inner content on top-level commas, treating
 * `'...'` (with `''` as an escaped quote) as opaque so commas/parens inside
 * a title or URL never get mistaken for field separators. */
function splitTopLevelSqlValues(inner: string): string[] {
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

/** Extracts `id -> { title, canonical_url }` for every row across every
 * batched `INSERT INTO entries (...)` statement in a snapshot SQL file. */
export function parseEntryLinksFromSnapshotSql(sql: string): Map<string, SnapshotEntryLink> {
  const result = new Map<string, SnapshotEntryLink>();
  let searchFrom = 0;

  while (true) {
    const headerIndex = sql.indexOf(ENTRIES_HEADER, searchFrom);
    if (headerIndex === -1) break;
    const valuesIndex = sql.indexOf("VALUES", headerIndex);
    if (valuesIndex === -1) {
      throw new Error("Malformed snapshot SQL: 'entries' INSERT has no VALUES keyword");
    }

    let i = valuesIndex + "VALUES".length;
    while (i < sql.length) {
      while (i < sql.length && /[\s,]/.test(sql[i]!)) i += 1;
      if (sql[i] === ";") {
        i += 1;
        break;
      }
      if (sql[i] !== "(") {
        throw new Error(
          `Malformed snapshot SQL: expected '(' or ';' at offset ${i}, found ${JSON.stringify(sql.slice(i, i + 20))}`,
        );
      }
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
      const tupleInner = sql.slice(tupleStart, j - 1);
      const fields = splitTopLevelSqlValues(tupleInner);
      const id = parseSqlLiteral(fields[0]);
      const title = parseSqlLiteral(fields[1]);
      const canonicalUrl = parseSqlLiteral(fields[5]);
      if (id !== null && title !== null && canonicalUrl !== null) {
        result.set(id, { title, canonical_url: canonicalUrl });
      }
      i = j;
    }
    searchFrom = i;
  }

  return result;
}
