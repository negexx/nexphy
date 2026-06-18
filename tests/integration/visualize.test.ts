import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { run as buildRun } from "../../src/cli/build.ts";
import { openDb } from "../../src/storage/db.ts";
import type { SqliteDb } from "../../src/storage/interface.ts";
import { loadGraphData } from "../../src/visualize/data.ts";

const fixtureDir = join(import.meta.dir, "../../fixtures/simple-ts");
const dbPath = join(fixtureDir, ".nexphy.db");

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      /* ok */
    }
  }
}

let db: SqliteDb;

beforeAll(async () => {
  cleanupDb();
  await buildRun([fixtureDir]);
  db = openDb(dbPath);
});

afterAll(() => {
  db.close();
  cleanupDb();
});

describe("loadGraphData", () => {
  test("returns nodes with string ids (symbol_ids)", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.nodes.length).toBeGreaterThan(0);
    for (const n of data.nodes) {
      expect(n.id).toContain("#");
    }
  });

  test("no <module> nodes in output", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const n of data.nodes) {
      expect(n.name).not.toMatch(/^<module/);
    }
  });

  test("edges use symbol_id strings not integers", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const e of data.edges) {
      expect(e.src).toContain("#");
      expect(e.dst).toContain("#");
    }
  });

  test("meta has correct nodeCount and edgeCount", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.meta.nodeCount).toBe(data.nodes.length);
    expect(data.meta.edgeCount).toBe(data.edges.length);
  });
});
