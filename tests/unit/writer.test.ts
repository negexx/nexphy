import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/storage/db.ts";
import {
  updateCommunity,
  updatePagerank,
  upsertEdge,
  upsertFile,
  upsertNode,
} from "../../src/storage/writer.ts";

function makeTempDb() {
  const path = join(tmpdir(), `tsgraph-writer-${Date.now()}.db`);
  return { path, db: openDb(path) };
}
function cleanup(path: string) {
  for (const s of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + s);
    } catch {
      /* ok */
    }
  }
}

describe("upsertFile", () => {
  test("inserts a new file and returns its id", () => {
    const { path, db } = makeTempDb();
    const id = upsertFile(db, {
      path: "src/index.ts",
      contentHash: "abc",
      shapeHash: "def",
      analyzedAt: 1000,
    });
    expect(typeof id).toBe("bigint");
    expect(id).toBeGreaterThan(0n);
    db.close();
    cleanup(path);
  });

  test("upserts (replaces) on conflict", () => {
    const { path, db } = makeTempDb();
    const id1 = upsertFile(db, {
      path: "src/index.ts",
      contentHash: "abc",
      shapeHash: "def",
      analyzedAt: 1000,
    });
    const id2 = upsertFile(db, {
      path: "src/index.ts",
      contentHash: "xyz",
      shapeHash: "uvw",
      analyzedAt: 2000,
    });
    expect(id1).toBe(id2);
    db.close();
    cleanup(path);
  });
});

describe("upsertNode", () => {
  test("inserts a node and returns its id", () => {
    const { path, db } = makeTempDb();
    const fileId = upsertFile(db, {
      path: "src/a.ts",
      contentHash: "h",
      shapeHash: "s",
      analyzedAt: 1,
    });
    const nodeId = upsertNode(db, {
      symbolId: "src/a.ts#greet",
      name: "greet",
      kind: "function",
      fileId,
      lineStart: 1,
      lineEnd: 3,
      signature: "greet(name: string): string",
      isEntry: true,
    });
    expect(typeof nodeId).toBe("bigint");
    db.close();
    cleanup(path);
  });
});

describe("upsertEdge", () => {
  test("inserts an edge between two nodes", () => {
    const { path, db } = makeTempDb();
    const fid = upsertFile(db, {
      path: "src/a.ts",
      contentHash: "h",
      shapeHash: "s",
      analyzedAt: 1,
    });
    const src = upsertNode(db, {
      symbolId: "src/a.ts#A",
      name: "A",
      kind: "function",
      fileId: fid,
      lineStart: 1,
      lineEnd: 1,
      signature: null,
      isEntry: false,
    });
    const dst = upsertNode(db, {
      symbolId: "src/a.ts#B",
      name: "B",
      kind: "function",
      fileId: fid,
      lineStart: 2,
      lineEnd: 2,
      signature: null,
      isEntry: false,
    });
    upsertEdge(db, { srcId: src, dstId: dst, kind: "calls", key: null });
    const edges = db.all<{ src: number; dst: number }>("SELECT src, dst FROM edges");
    expect(edges).toHaveLength(1);
    db.close();
    cleanup(path);
  });

  test("ignores duplicate (src, dst, kind) edges", () => {
    const { path, db } = makeTempDb();
    const fid = upsertFile(db, {
      path: "src/a.ts",
      contentHash: "h",
      shapeHash: "s",
      analyzedAt: 1,
    });
    const src = upsertNode(db, {
      symbolId: "src/a.ts#A",
      name: "A",
      kind: "function",
      fileId: fid,
      lineStart: 1,
      lineEnd: 1,
      signature: null,
      isEntry: false,
    });
    const dst = upsertNode(db, {
      symbolId: "src/a.ts#B",
      name: "B",
      kind: "function",
      fileId: fid,
      lineStart: 2,
      lineEnd: 2,
      signature: null,
      isEntry: false,
    });
    upsertEdge(db, { srcId: src, dstId: dst, kind: "calls", key: null });
    upsertEdge(db, { srcId: src, dstId: dst, kind: "calls", key: null });
    const edges = db.all("SELECT * FROM edges");
    expect(edges).toHaveLength(1);
    db.close();
    cleanup(path);
  });
});

describe("updatePagerank / updateCommunity", () => {
  test("updates node rank and community without error", () => {
    const { path, db } = makeTempDb();
    const fid = upsertFile(db, {
      path: "src/a.ts",
      contentHash: "h",
      shapeHash: "s",
      analyzedAt: 1,
    });
    const nid = upsertNode(db, {
      symbolId: "src/a.ts#A",
      name: "A",
      kind: "function",
      fileId: fid,
      lineStart: 1,
      lineEnd: 1,
      signature: null,
      isEntry: false,
    });
    updatePagerank(db, nid, 0.42);
    updateCommunity(db, nid, 7);
    const row = db.get<{ pagerank: number; community: number }>(
      "SELECT pagerank, community FROM nodes WHERE id = ?",
      Number(nid),
    );
    expect(row?.pagerank).toBeCloseTo(0.42);
    expect(row?.community).toBe(7);
    db.close();
    cleanup(path);
  });
});
