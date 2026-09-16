/** Read-only D1 facade for contributed collection handlers. */

export class CollectionDb {
  constructor(private readonly db: D1Database) {}

  async query<T extends Record<string, unknown>>(
    sql: string,
    binds: unknown[] = [],
  ): Promise<T[]> {
    assertReadOnlySelect(sql);
    const stmt = binds.length > 0 ? this.db.prepare(sql).bind(...binds) : this.db.prepare(sql);
    const result = await stmt.all<T>();
    return result.results ?? [];
  }

  async first<T extends Record<string, unknown>>(
    sql: string,
    binds: unknown[] = [],
  ): Promise<T | null> {
    assertReadOnlySelect(sql);
    const stmt = binds.length > 0 ? this.db.prepare(sql).bind(...binds) : this.db.prepare(sql);
    const row = await stmt.first<T>();
    return row ?? null;
  }
}

const WRITE_OR_DDL =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REPLACE|UPSERT|VACUUM|REINDEX)\b/i;

export function assertReadOnlySelect(sql: string): void {
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
  if (!/^SELECT\b/i.test(stripped)) {
    throw new Error("Collection handlers may only run SELECT statements");
  }
  const withoutTrailing = stripped.replace(/;+\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed");
  }
  if (WRITE_OR_DDL.test(stripped)) {
    throw new Error("Write or DDL SQL is not allowed");
  }
}
