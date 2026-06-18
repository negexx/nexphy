/**
 * Tests for the Node.js SQLite adapter (better-sqlite3).
 * Run with: bun run test:node
 * These tests are excluded from `bun test` because better-sqlite3
 * is a native Node.js addon unsupported in Bun (bun#4290).
 */
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, afterEach, describe, it } from "node:test";
import { createNodeSqliteDb } from "../../src/storage/node-sqlite.ts";

const TEST_DB_DIR = tmpdir();
const usedPaths: string[] = [];

function makeTempPath(): string {
  const path = `${TEST_DB_DIR}/tsgraph-test-node-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
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
after(cleanup);

describe("createNodeSqliteDb", () => {
  it("creates a db file and run() returns changes + lastInsertRowid as bigint", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const result = db.run("INSERT INTO t (v) VALUES (?)", "hello");
    assert.equal(result.changes, 1);
    assert.equal(result.lastInsertRowid, 1n);
    db.close();
  });

  it("get() returns undefined when no row matches", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const row = db.get<{ v: string }>("SELECT v FROM t WHERE id = ?", 999);
    assert.equal(row, undefined);
    db.close();
  });

  it("get() returns the matching row", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    db.run("INSERT INTO t (v) VALUES (?)", "world");
    const row = db.get<{ v: string }>("SELECT v FROM t WHERE id = ?", 1);
    assert.equal(row?.v, "world");
    db.close();
  });

  it("all() returns all rows in order", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    db.run("INSERT INTO t (v) VALUES (?)", "a");
    db.run("INSERT INTO t (v) VALUES (?)", "b");
    db.run("INSERT INTO t (v) VALUES (?)", "c");
    const rows = db.all<{ v: string }>("SELECT v FROM t ORDER BY id");
    assert.deepEqual(
      rows.map((r) => r.v),
      ["a", "b", "c"],
    );
    db.close();
  });

  it("prepare() returns a reusable statement", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const stmt = db.prepare<{ id: number; v: string }>("INSERT INTO t (v) VALUES (?)");
    stmt.run("x");
    stmt.run("y");
    const rows = db.all<{ v: string }>("SELECT v FROM t ORDER BY id");
    assert.deepEqual(
      rows.map((r) => r.v),
      ["x", "y"],
    );
    db.close();
  });

  it("lastInsertRowid is always returned as bigint", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    const r1 = db.run("INSERT INTO t (v) VALUES (?)", "first");
    const r2 = db.run("INSERT INTO t (v) VALUES (?)", "second");
    assert.equal(typeof r1.lastInsertRowid, "bigint");
    assert.equal(r1.lastInsertRowid, 1n);
    assert.equal(r2.lastInsertRowid, 2n);
    db.close();
  });

  it("prepare() statement get() and all() work correctly", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
    db.run("INSERT INTO t (v) VALUES (?)", "alpha");
    db.run("INSERT INTO t (v) VALUES (?)", "beta");
    const getStmt = db.prepare<{ v: string }>("SELECT v FROM t WHERE id = ?");
    assert.equal(getStmt.get(1)?.v, "alpha");
    assert.equal(getStmt.get(999), undefined);
    const allStmt = db.prepare<{ v: string }>("SELECT v FROM t ORDER BY id");
    assert.deepEqual(
      allStmt.all().map((r) => r.v),
      ["alpha", "beta"],
    );
    db.close();
  });

  it("transaction() rolls back all changes on error", () => {
    const db = createNodeSqliteDb(makeTempPath());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)");
    try {
      db.transaction(() => {
        db.run("INSERT INTO t (v) VALUES (?)", "valid");
        db.run("INSERT INTO t (v) VALUES (?)", null as unknown as string);
      });
    } catch {
      /* expected */
    }
    const rows = db.all("SELECT * FROM t");
    assert.equal(rows.length, 0);
    db.close();
  });
});
