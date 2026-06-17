import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/cli/build.ts";
import { openDb } from "../../src/storage/db.ts";

const fixtureDir = join(import.meta.dir, "../../fixtures/simple-ts");
const dbPath = join(fixtureDir, ".tsgraph.db");

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      /* already gone */
    }
  }
}

describe("build command E2E", () => {
  beforeAll(async () => {
    cleanupDb();
    await run([fixtureDir]);
  });

  afterAll(() => {
    cleanupDb();
  });

  test("creates .tsgraph.db in the project directory", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  test("writes nodes for exported symbols", () => {
    const db = openDb(dbPath);
    const nodes = db.all<{ name: string }>("SELECT name FROM nodes WHERE is_entry = 1");
    db.close();
    // VERSION, greet, add — all exported
    expect(nodes.length).toBeGreaterThanOrEqual(3);
  });

  test("stores paths as POSIX-normalized strings", () => {
    const db = openDb(dbPath);
    const files = db.all<{ path: string }>("SELECT path FROM files");
    db.close();
    for (const file of files) {
      expect(file.path).not.toContain("\\");
    }
  });

  test("pagerank values are positive for all nodes", () => {
    const db = openDb(dbPath);
    const rows = db.all<{ pagerank: number | null }>("SELECT pagerank FROM nodes");
    db.close();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.pagerank).not.toBeNull();
      expect(row.pagerank as number).toBeGreaterThan(0);
    }
  });

  test("second run is idempotent (same node count)", async () => {
    const db1 = openDb(dbPath);
    const before = db1.all<{ id: number }>("SELECT id FROM nodes").length;
    db1.close();

    await run([fixtureDir]);

    const db2 = openDb(dbPath);
    const after = db2.all<{ id: number }>("SELECT id FROM nodes").length;
    db2.close();

    expect(after).toBe(before);
  });
});
