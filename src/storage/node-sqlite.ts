import BetterSqlite3 from "better-sqlite3";
import type { RowResult, SqliteDb, SqliteStatement } from "./interface.ts";

// biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 Statement uses any[] for variadic bind params
type BindParams = any[];

class NodeStatement<T = unknown> implements SqliteStatement<T> {
  private readonly stmt: BetterSqlite3.Statement;

  constructor(stmt: BetterSqlite3.Statement) {
    this.stmt = stmt;
  }

  run(...params: unknown[]): RowResult {
    const r = this.stmt.run(...(params as BindParams));
    return { changes: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  }

  get(...params: unknown[]): T | undefined {
    const result = this.stmt.get(...(params as BindParams));
    return result == null ? undefined : (result as T);
  }

  all(...params: unknown[]): T[] {
    return this.stmt.all(...(params as BindParams)) as T[];
  }
}

class NodeSqliteDb implements SqliteDb {
  private readonly db: BetterSqlite3.Database;

  constructor(path: string) {
    this.db = new BetterSqlite3(path);
  }

  prepare<T = unknown>(sql: string): SqliteStatement<T> {
    return new NodeStatement<T>(this.db.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): RowResult {
    const r = this.db.prepare(sql).run(...(params as BindParams));
    return { changes: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    const result = this.db.prepare(sql).get(...(params as BindParams));
    return result == null ? undefined : (result as T);
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as BindParams)) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)() as T;
  }

  close(): void {
    this.db.close();
  }
}

export function createNodeSqliteDb(path: string): SqliteDb {
  return new NodeSqliteDb(path);
}
