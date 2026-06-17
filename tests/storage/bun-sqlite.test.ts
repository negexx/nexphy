import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { createBunSqliteDb } from "../../src/storage/bun-sqlite.ts";

const TEST_DB_DIR = tmpdir();
const usedPaths: string[] = [];

function makeTempPath(): string {
  const path = `${TEST_DB_DIR}/tsgraph-test-bun-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  usedPaths.push(path);
  return path;
}

function cleanup() {
  for (const dbPath of usedPaths.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {
        /* ok */
      }
    }
  }
}

afterEach(cleanup);

describe("createBunSqliteDb", () => {
  test("creates a db file and run() returns changes + lastInsertRowid as bigint", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const result = db.run("INSERT INTO t (v) VALUES (?)", "hello");
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1n);
    db.close();
  });

  test("get() returns undefined when no row matches", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const row = db.get<{ v: string }>("SELECT v FROM t WHERE id = ?", 999);
    expect(row).toBeUndefined();
    db.close();
  });

  test("get() returns the matching row typed correctly", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    db.run("INSERT INTO t (v) VALUES (?)", "world");
    const row = db.get<{ v: string }>("SELECT v FROM t WHERE id = ?", 1);
    expect(row?.v).toBe("world");
    db.close();
  });

  test("all() returns all rows in order", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    db.run("INSERT INTO t (v) VALUES (?)", "a");
    db.run("INSERT INTO t (v) VALUES (?)", "b");
    db.run("INSERT INTO t (v) VALUES (?)", "c");
    const rows = db.all<{ v: string }>("SELECT v FROM t ORDER BY id");
    expect(rows.map((r) => r.v)).toEqual(["a", "b", "c"]);
    db.close();
  });

  test("prepare() returns a reusable statement", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const stmt = db.prepare<{ id: number; v: string }>("INSERT INTO t (v) VALUES (?)");
    stmt.run("x");
    stmt.run("y");
    const rows = db.all<{ v: string }>("SELECT v FROM t ORDER BY id");
    expect(rows.map((r) => r.v)).toEqual(["x", "y"]);
    db.close();
  });

  test("lastInsertRowid is always returned as bigint", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const r1 = db.run("INSERT INTO t (v) VALUES (?)", "first");
    const r2 = db.run("INSERT INTO t (v) VALUES (?)", "second");
    expect(typeof r1.lastInsertRowid).toBe("bigint");
    expect(r1.lastInsertRowid).toBe(1n);
    expect(r2.lastInsertRowid).toBe(2n);
    db.close();
  });

  test("transaction() rolls back all changes on error", () => {
    const db = createBunSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)");
    try {
      db.transaction(() => {
        db.run("INSERT INTO t (v) VALUES (?)", "valid");
        // intentional null to trigger NOT NULL constraint
        db.run("INSERT INTO t (v) VALUES (?)", null as unknown as string);
      });
    } catch {
      /* expected */
    }
    const rows = db.all("SELECT * FROM t");
    expect(rows).toHaveLength(0);
    db.close();
  });
});
