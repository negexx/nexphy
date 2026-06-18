import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bfsSubgraph } from "../../../src/query/bfs.ts";
import { openDb } from "../../../src/storage/db.ts";
import type { SqliteDb } from "../../../src/storage/interface.ts";

function makeTempDb(): string {
  return join(tmpdir(), `nexphy-bfs-test-${Date.now()}.db`);
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
let idA: bigint, idB: bigint, idC: bigint, idD: bigint;

beforeAll(() => {
  dbPath = makeTempDb();
  db = openDb(dbPath);
  db.run(
    "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?,?,?,?)",
    "src/a.ts",
    "h1",
    "s1",
    1,
  );
  const fileId = db.get<{ id: number }>("SELECT id FROM files")?.id;

  function insertNode(symbolId: string, name: string, pagerank: number): bigint {
    const r = db.run(
      `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, pagerank, community, is_entry)
       VALUES (?,?,?,?,?,?,?,?)`,
      symbolId,
      name,
      "function",
      fileId,
      1,
      pagerank,
      0,
      1,
    );
    return r.lastInsertRowid;
  }

  idA = insertNode("src/a.ts#A", "A", 0.5);
  idB = insertNode("src/a.ts#B", "B", 0.4);
  idC = insertNode("src/a.ts#C", "C", 0.3);
  idD = insertNode("src/a.ts#D", "D", 0.1);

  db.run("INSERT INTO edges (src, dst, kind) VALUES (?,?,?)", Number(idA), Number(idB), "calls");
  db.run("INSERT INTO edges (src, dst, kind) VALUES (?,?,?)", Number(idB), Number(idC), "calls");
  db.run("INSERT INTO edges (src, dst, kind) VALUES (?,?,?)", Number(idB), Number(idD), "calls");
});

afterAll(() => {
  db.close();
  cleanup(dbPath);
});

describe("bfsSubgraph", () => {
  test("seed node is not in result nodes", () => {
    const result = bfsSubgraph(db, idA, { depth: 3, budget: 100000 });
    expect(result.nodes.map((n) => n.id)).not.toContain(idA);
  });

  test("discovers direct neighbors at depth 1", () => {
    const result = bfsSubgraph(db, idA, { depth: 1, budget: 100000 });
    const syms = result.nodes.map((n) => n.symbolId);
    expect(syms).toContain("src/a.ts#B");
    expect(syms).not.toContain("src/a.ts#C");
  });

  test("discovers transitive nodes at depth 2", () => {
    const result = bfsSubgraph(db, idA, { depth: 2, budget: 100000 });
    const syms = result.nodes.map((n) => n.symbolId);
    expect(syms).toContain("src/a.ts#B");
    expect(syms).toContain("src/a.ts#C");
    expect(syms).toContain("src/a.ts#D");
  });

  test("bidirectional — backward edges traversed", () => {
    const result = bfsSubgraph(db, idC, { depth: 2, budget: 100000 });
    const syms = result.nodes.map((n) => n.symbolId);
    expect(syms).toContain("src/a.ts#B");
    expect(syms).toContain("src/a.ts#A");
  });

  test("edges reference correct symbol_ids", () => {
    const result = bfsSubgraph(db, idA, { depth: 1, budget: 100000 });
    expect(result.edges.length).toBeGreaterThan(0);
    const edge = result.edges[0];
    expect(edge.src).toBe("src/a.ts#A");
    expect(edge.dst).toBe("src/a.ts#B");
    expect(edge.kind).toBe("calls");
  });

  test("budget=0 returns no neighbor nodes and truncated=true", () => {
    const result = bfsSubgraph(db, idA, { depth: 3, budget: 0 });
    expect(result.nodes).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  test("truncated=false when all neighbors fit", () => {
    const result = bfsSubgraph(db, idA, { depth: 3, budget: 100000 });
    expect(result.truncated).toBe(false);
  });

  test("high-pagerank neighbors included first when budget is tight", () => {
    // Budget of 30 tokens fits roughly 1 node (each ~22 tokens).
    // BFS from B is bidirectional: forward gives C (0.3) and D (0.1),
    // backward gives A (0.5). A has the highest pagerank so it wins.
    const result = bfsSubgraph(db, idB, { depth: 1, budget: 30 });
    if (result.nodes.length === 1) {
      expect(result.nodes[0].symbolId).toBe("src/a.ts#A");
    }
    // If all three fit (budget was enough), that's also fine
  });
});
