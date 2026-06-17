export interface RowResult {
  changes: number;
  lastInsertRowid: bigint;
}

export interface SqliteStatement<T = unknown> {
  run(...params: unknown[]): RowResult;
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface SqliteDb {
  prepare<T = unknown>(sql: string): SqliteStatement<T>;
  run(sql: string, ...params: unknown[]): RowResult;
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}
