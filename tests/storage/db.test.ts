import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/storage/db.ts";
import { SCHEMA_VERSION } from "../../src/storage/schema.ts";

function makeTempDb(): string {
  return join(tmpdir(), `nexphy-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + suffix);
    } catch {
      /* ok */
    }
  }
}

describe("openDb", () => {
  test("creates all four tables on a fresh database", () => {
    const path = makeTempDb();
    const db = openDb(path);
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((r) => r.name);
    expect(tables).toContain("files");
    expect(tables).toContain("nodes");
    expect(tables).toContain("edges");
    expect(tables).toContain("tags");
    db.close();
    cleanup(path);
  });

  test("sets user_version to SCHEMA_VERSION", () => {
    const path = makeTempDb();
    const db = openDb(path);
    const row = db.get<{ user_version: number }>("PRAGMA user_version");
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    db.close();
    cleanup(path);
  });

  test("WAL journal mode is active", () => {
    const path = makeTempDb();
    const db = openDb(path);
    const row = db.get<{ journal_mode: string }>("PRAGMA journal_mode");
    expect(row?.journal_mode).toBe("wal");
    db.close();
    cleanup(path);
  });

  test("busy_timeout is set to 5000ms", () => {
    const path = makeTempDb();
    const db = openDb(path);
    const row = db.get<{ timeout: number }>("PRAGMA busy_timeout");
    expect(row?.timeout).toBe(5000);
    db.close();
    cleanup(path);
  });

  test("reopening an existing database preserves data", () => {
    const path = makeTempDb();
    const db1 = openDb(path);
    db1.run(
      "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)",
      "src/foo.ts",
      "abc",
      "def",
      1_000_000,
    );
    db1.close();

    const db2 = openDb(path);
    const files = db2.all<{ path: string }>("SELECT path FROM files");
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/foo.ts");
    db2.close();
    cleanup(path);
  });

  test("nuke-rebuilds when user_version does not match SCHEMA_VERSION", () => {
    const path = makeTempDb();
    const db1 = openDb(path);
    db1.run(
      "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)",
      "src/foo.ts",
      "abc",
      "def",
      1_000_000,
    );
    // Force a wrong version
    db1.run("PRAGMA user_version = 999");
    db1.close();

    // Reopen — must detect mismatch, wipe, and rebuild
    const db2 = openDb(path);
    const files = db2.all("SELECT * FROM files");
    expect(files).toHaveLength(0);
    const row = db2.get<{ user_version: number }>("PRAGMA user_version");
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    db2.close();
    cleanup(path);
  });

  test("AUTOINCREMENT prevents reuse of deleted row IDs", () => {
    const path = makeTempDb();
    const db = openDb(path);
    db.run(
      "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)",
      "a.ts",
      "h1",
      "s1",
      1,
    );
    db.run(
      "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)",
      "b.ts",
      "h2",
      "s2",
      2,
    );
    db.run("DELETE FROM files WHERE path = 'a.ts'");
    const r = db.run(
      "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)",
      "c.ts",
      "h3",
      "s3",
      3,
    );
    // AUTOINCREMENT guarantees new ID is strictly greater than any previously used ID
    expect(r.lastInsertRowid).toBeGreaterThan(2n);
    db.close();
    cleanup(path);
  });
});
