import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSeed } from "../../../src/query/seed.ts";
import { openDb } from "../../../src/storage/db.ts";
import type { SqliteDb } from "../../../src/storage/interface.ts";

function makeTempDb(): string {
  return join(tmpdir(), `tsgraph-seed-test-${Date.now()}.db`);
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

let db: SqliteDb;
let dbPath: string;

beforeAll(() => {
  dbPath = makeTempDb();
  db = openDb(dbPath);
  db.run(
    "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?,?,?,?)",
    "src/index.ts",
    "h1",
    "s1",
    1,
  );
  const fileId = db.get<{ id: number }>("SELECT id FROM files WHERE path = ?", "src/index.ts")?.id;
  if (fileId === undefined) {
    throw new Error("Failed to get file ID");
  }
  db.run(
    `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, line_end, pagerank, community, is_entry)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    "src/index.ts::greet",
    "greet",
    "function",
    fileId,
    5,
    10,
    0.42,
    1,
    1,
  );
  db.run(
    `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, line_end, pagerank, community, is_entry)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    "src/index.ts::VERSION",
    "VERSION",
    "variable",
    fileId,
    1,
    1,
    0.2,
    1,
    1,
  );
});

afterAll(() => {
  db.close();
  cleanup(dbPath);
});

describe("resolveSeed", () => {
  test("resolves by exact symbol_id", () => {
    const node = resolveSeed(db, "src/index.ts::greet");
    expect(node.symbolId).toBe("src/index.ts::greet");
    expect(node.name).toBe("greet");
  });

  test("resolves by bare name — top-1 by pagerank", () => {
    const node = resolveSeed(db, "greet");
    expect(node.symbolId).toBe("src/index.ts::greet");
  });

  test("resolves bare name substring match", () => {
    const node = resolveSeed(db, "VERSION");
    expect(node.name).toBe("VERSION");
  });

  test("throws descriptive error when seed not found", () => {
    expect(() => resolveSeed(db, "doesNotExist")).toThrow(/no symbol found matching/i);
  });

  test("node row has correct shape", () => {
    const node = resolveSeed(db, "src/index.ts::greet");
    expect(node.id).toBeGreaterThan(0n);
    expect(node.filePath).toBe("src/index.ts");
    expect(node.lineStart).toBe(5);
    expect(node.pagerank).toBeCloseTo(0.42);
    expect(node.isEntry).toBe(true);
  });
});
