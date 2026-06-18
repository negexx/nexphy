import type { SQLQueryBindings } from "bun:sqlite";
import { Database } from "bun:sqlite";
import type { RowResult, SqliteDb, SqliteStatement } from "./interface.ts";

type Params = SQLQueryBindings[];

class BunStatement<T = unknown> implements SqliteStatement<T> {
  constructor(private readonly stmt: ReturnType<Database["prepare"]>) {}

  run(...params: unknown[]): RowResult {
    const r = this.stmt.run(...(params as Params));
    return { changes: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  }

  get(...params: unknown[]): T | undefined {
    const result = this.stmt.get(...(params as Params));
    return result == null ? undefined : (result as T);
  }

  all(...params: unknown[]): T[] {
    return this.stmt.all(...(params as Params)) as T[];
  }
}

class BunSqliteDb implements SqliteDb {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
  }

  prepare<T = unknown>(sql: string): SqliteStatement<T> {
    return new BunStatement<T>(this.db.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): RowResult {
    const r = this.db.prepare(sql).run(...(params as Params));
    return { changes: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    const result = this.db.prepare(sql).get(...(params as Params));
    return result == null ? undefined : (result as T);
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as Params)) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

export function createBunSqliteDb(path: string): SqliteDb {
  return new BunSqliteDb(path);
}
