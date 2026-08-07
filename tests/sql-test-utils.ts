/** Shared SQL-fixture-loading helpers for the Workers-pool test suite. */

/**
 * Split a SQL script into statements. String-literal aware: `--` line
 * comments, `/* *\/` block comments, and `;` statement terminators are only
 * recognized outside single-quoted strings (with `''` as an escaped quote),
 * so semicolons or `--` inside real title/author text never truncate a
 * statement early.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (inString) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i += 2;
          continue;
        }
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inString = true;
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

export async function execStatements(db: D1Database, sql: string): Promise<void> {
  for (const statement of splitSql(sql)) {
    await db.prepare(statement).run();
  }
}
