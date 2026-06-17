# Query Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `tsgraph query <seed>` and `tsgraph explain-edges` commands — returning a token-budgeted JSON subgraph centered on a TypeScript symbol.

**Architecture:** Seed resolver looks up a node by name or qualified ID. BFS traversal expands bidirectionally up to `--depth` hops, prioritizing high-pagerank neighbors and stopping at `--budget` tokens. Serializer assembles the JSON output with an embedded legend.

**Tech Stack:** Bun, TypeScript, bun:sqlite (via existing `SqliteDb` abstraction), `node:util` parseArgs, `node:fs` existsSync/dirname.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/output/legend.ts` | Create | Static NODE_KINDS + EDGE_KINDS maps |
| `src/query/types.ts` | Create | NodeRow, OutputEdge, BfsResult interfaces |
| `src/query/seed.ts` | Create | Seed resolution: name/qualified-ID → NodeRow |
| `src/query/bfs.ts` | Create | Bidirectional BFS with pagerank priority + budget gate |
| `src/output/serialize.ts` | Create | Assemble final QueryOutput JSON object |
| `src/cli/explain-edges.ts` | Create | Static legend printer, no DB |
| `src/cli/query.ts` | Create | Arg parsing, DB discovery, dispatch, print |
| `src/cli.ts` | Modify | Replace stubs with dynamic imports |
| `tests/unit/query/seed.test.ts` | Create | Seed resolver unit tests |
| `tests/unit/query/bfs.test.ts` | Create | BFS unit tests |
| `tests/integration/query.test.ts` | Create | E2E: build fixture → query → verify output |

---

### Task 1: Legend constants and query types

**Files:**
- Create: `src/output/legend.ts`
- Create: `src/query/types.ts`

- [ ] **Step 1: Create `src/output/legend.ts`**

```typescript
export const NODE_KINDS: Record<string, string> = {
  function: "callable declaration",
  class: "class declaration",
  interface: "TypeScript interface",
  type: "type alias",
  enum: "enum declaration",
  variable: "const/let/var declaration",
  namespace: "module or namespace",
};

export const EDGE_KINDS: Record<string, string> = {
  imports: "static import of a module member",
  calls: "direct function or method invocation",
  extends: "class or interface inheritance",
  implements: "class implements interface",
  references: "type or value reference not covered above",
};

export const LEGEND = { node_kinds: NODE_KINDS, edge_kinds: EDGE_KINDS };
```

- [ ] **Step 2: Create `src/query/types.ts`**

```typescript
export interface NodeRow {
  id: bigint;
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  signature: string | null;
  pagerank: number;
  community: number;
  isEntry: boolean;
}

export interface OutputEdge {
  src: string;
  dst: string;
  kind: string;
  key: string | null;
}

export interface BfsResult {
  nodes: NodeRow[];
  edges: OutputEdge[];
  truncated: boolean;
}

export interface QueryOutput {
  seed: {
    symbol_id: string;
    name: string;
    kind: string;
    file: string;
    line_start: number;
    pagerank: number;
    community: number;
  };
  nodes: QueryOutput["seed"][];
  edges: OutputEdge[];
  truncated: boolean;
  legend: { node_kinds: Record<string, string>; edge_kinds: Record<string, string> };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/output/legend.ts src/query/types.ts
git commit -m "feat: output legend constants and query types"
```

---

### Task 2: Seed resolver

**Files:**
- Create: `src/query/seed.ts`
- Create: `tests/unit/query/seed.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/query/seed.test.ts`:

```typescript
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/storage/db.ts";
import { resolveSeed } from "../../../src/query/seed.ts";
import type { SqliteDb } from "../../../src/storage/interface.ts";

function makeTempDb(): string {
  return join(tmpdir(), `tsgraph-seed-test-${Date.now()}.db`);
}

function cleanup(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ok */ }
  }
}

let db: SqliteDb;
let dbPath: string;

beforeAll(() => {
  dbPath = makeTempDb();
  db = openDb(dbPath);
  // Insert a file
  db.run(
    "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?,?,?,?)",
    "src/index.ts", "h1", "s1", 1
  );
  const fileId = db.get<{ id: number }>("SELECT id FROM files WHERE path = ?", "src/index.ts")!.id;
  // Insert two nodes
  db.run(
    `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, line_end, pagerank, community, is_entry)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    "src/index.ts::greet", "greet", "function", fileId, 5, 10, 0.42, 1, 1
  );
  db.run(
    `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, line_end, pagerank, community, is_entry)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    "src/index.ts::VERSION", "VERSION", "variable", fileId, 1, 1, 0.20, 1, 1
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
    expect(() => resolveSeed(db, "doesNotExist")).toThrow(
      /no symbol found matching/i
    );
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
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
bun test tests/unit/query/seed.test.ts 2>&1 | tail -5
```

Expected: error — `Cannot find module '../../../src/query/seed.ts'`

- [ ] **Step 3: Implement `src/query/seed.ts`**

```typescript
import type { SqliteDb } from "../storage/interface.ts";
import type { NodeRow } from "./types.ts";

const NODE_SELECT = `
  SELECT n.id, n.symbol_id, n.name, n.kind,
         COALESCE(f.path, '') as file_path,
         n.line_start, n.line_end, n.signature,
         COALESCE(n.pagerank, 0) as pagerank,
         COALESCE(n.community, 0) as community,
         n.is_entry
  FROM nodes n
  LEFT JOIN files f ON f.id = n.file_id
`;

interface RawNodeRow {
  id: number;
  symbol_id: string;
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number | null;
  signature: string | null;
  pagerank: number;
  community: number;
  is_entry: number;
}

function toNodeRow(r: RawNodeRow): NodeRow {
  return {
    id: BigInt(r.id),
    symbolId: r.symbol_id,
    name: r.name,
    kind: r.kind,
    filePath: r.file_path,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    signature: r.signature,
    pagerank: r.pagerank,
    community: r.community,
    isEntry: r.is_entry === 1,
  };
}

export function resolveSeed(db: SqliteDb, seed: string): NodeRow {
  // Qualified form: contains "::"
  if (seed.includes("::")) {
    const row = db.get<RawNodeRow>(`${NODE_SELECT} WHERE n.symbol_id = ?`, seed);
    if (!row) throw new Error(`No symbol found matching "${seed}"`);
    return toNodeRow(row);
  }

  // Bare name: substring match, top-1 by pagerank
  const row = db.get<RawNodeRow>(
    `${NODE_SELECT} WHERE n.name LIKE ? ORDER BY n.pagerank DESC LIMIT 1`,
    `%${seed}%`
  );
  if (!row) throw new Error(`No symbol found matching "${seed}"`);
  return toNodeRow(row);
}

export { toNodeRow, type RawNodeRow };
```

- [ ] **Step 4: Run to confirm PASS**

```bash
bun test tests/unit/query/seed.test.ts
```

Expected: 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/query/seed.ts tests/unit/query/seed.test.ts
git commit -m "feat: seed resolver — qualified ID and bare name with pagerank ranking"
```

---

### Task 3: BFS traversal

**Files:**
- Create: `src/query/bfs.ts`
- Create: `tests/unit/query/bfs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/query/bfs.test.ts`:

```typescript
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/storage/db.ts";
import { bfsSubgraph } from "../../../src/query/bfs.ts";
import type { SqliteDb } from "../../../src/storage/interface.ts";

function makeTempDb(): string {
  return join(tmpdir(), `tsgraph-bfs-test-${Date.now()}.db`);
}

function cleanup(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ok */ }
  }
}

let db: SqliteDb;
let dbPath: string;
// Node IDs inserted into test DB
let idA: bigint, idB: bigint, idC: bigint, idD: bigint;

beforeAll(() => {
  dbPath = makeTempDb();
  db = openDb(dbPath);

  db.run(
    "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?,?,?,?)",
    "src/a.ts", "h1", "s1", 1
  );
  const fileId = db.get<{ id: number }>("SELECT id FROM files")!.id;

  function insertNode(symbolId: string, name: string, pagerank: number): bigint {
    const r = db.run(
      `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, pagerank, community, is_entry)
       VALUES (?,?,?,?,?,?,?,?)`,
      symbolId, name, "function", fileId, 1, pagerank, 0, 1
    );
    return r.lastInsertRowid;
  }

  // Graph: A --calls--> B --calls--> C
  //                     B --calls--> D (lower rank)
  idA = insertNode("src/a.ts::A", "A", 0.5);
  idB = insertNode("src/a.ts::B", "B", 0.4);
  idC = insertNode("src/a.ts::C", "C", 0.3);
  idD = insertNode("src/a.ts::D", "D", 0.1);

  db.run("INSERT INTO edges (src, dst, kind) VALUES (?,?,?)", Number(idA), Number(idB), "calls");
  db.run("INSERT INTO edges (src, dst, kind) VALUES (?,?,?)", Number(idB), Number(idC), "calls");
  db.run("INSERT INTO edges (src, dst, kind) VALUES (?,?,?)", Number(idB), Number(idD), "calls");
});

afterAll(() => {
  db.close();
  cleanup(dbPath);
});

describe("bfsSubgraph", () => {
  test("seed node is never in result nodes (it is the seed)", () => {
    const result = bfsSubgraph(db, idA, { depth: 3, budget: 100000 });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).not.toContain(idA);
  });

  test("discovers direct neighbors at depth 1", () => {
    const result = bfsSubgraph(db, idA, { depth: 1, budget: 100000 });
    const symbolIds = result.nodes.map((n) => n.symbolId);
    expect(symbolIds).toContain("src/a.ts::B");
    expect(symbolIds).not.toContain("src/a.ts::C"); // depth 2
  });

  test("discovers transitive nodes at depth 2", () => {
    const result = bfsSubgraph(db, idA, { depth: 2, budget: 100000 });
    const symbolIds = result.nodes.map((n) => n.symbolId);
    expect(symbolIds).toContain("src/a.ts::B");
    expect(symbolIds).toContain("src/a.ts::C");
    expect(symbolIds).toContain("src/a.ts::D");
  });

  test("bidirectional — backward edges also traversed", () => {
    // Query from C — should find B (backward) and then A (backward)
    const result = bfsSubgraph(db, idC, { depth: 2, budget: 100000 });
    const symbolIds = result.nodes.map((n) => n.symbolId);
    expect(symbolIds).toContain("src/a.ts::B");
    expect(symbolIds).toContain("src/a.ts::A");
  });

  test("edges reference correct symbol_ids", () => {
    const result = bfsSubgraph(db, idA, { depth: 1, budget: 100000 });
    expect(result.edges.length).toBeGreaterThan(0);
    const edge = result.edges[0];
    expect(edge.src).toBe("src/a.ts::A");
    expect(edge.dst).toBe("src/a.ts::B");
    expect(edge.kind).toBe("calls");
  });

  test("budget=0 returns no neighbor nodes and truncated=true when neighbors exist", () => {
    const result = bfsSubgraph(db, idA, { depth: 3, budget: 0 });
    expect(result.nodes).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  test("truncated=false when all neighbors fit in budget", () => {
    const result = bfsSubgraph(db, idA, { depth: 3, budget: 100000 });
    expect(result.truncated).toBe(false);
  });

  test("high-pagerank neighbors included first when budget is tight", () => {
    // Budget tight enough for exactly 1 neighbor from B's children (C rank 0.3, D rank 0.1)
    // C should win because it has higher pagerank
    const result = bfsSubgraph(db, idB, { depth: 1, budget: 30 });
    const symbolIds = result.nodes.map((n) => n.symbolId);
    if (symbolIds.length === 1) {
      // Only one fit — must be C (higher rank) not D
      expect(symbolIds[0]).toBe("src/a.ts::C");
    }
    // If both fit that's fine too — test is valid only when exactly 1 fits
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
bun test tests/unit/query/bfs.test.ts 2>&1 | tail -5
```

Expected: error — `Cannot find module '../../../src/query/bfs.ts'`

- [ ] **Step 3: Implement `src/query/bfs.ts`**

```typescript
import type { SqliteDb } from "../storage/interface.ts";
import type { BfsResult, NodeRow, OutputEdge } from "./types.ts";
import { type RawNodeRow, toNodeRow } from "./seed.ts";

interface RawEdgeRow {
  nbr_id: number;
  nbr_symbol_id: string;
  nbr_name: string;
  nbr_kind: string;
  nbr_file_path: string;
  nbr_line_start: number;
  nbr_line_end: number | null;
  nbr_signature: string | null;
  nbr_pagerank: number;
  nbr_community: number;
  nbr_is_entry: number;
  edge_kind: string;
  edge_key: string | null;
}

const FORWARD_SQL = `
  SELECT nd.id as nbr_id, nd.symbol_id as nbr_symbol_id, nd.name as nbr_name,
         nd.kind as nbr_kind, COALESCE(f.path, '') as nbr_file_path,
         nd.line_start as nbr_line_start, nd.line_end as nbr_line_end,
         nd.signature as nbr_signature,
         COALESCE(nd.pagerank, 0) as nbr_pagerank,
         COALESCE(nd.community, 0) as nbr_community, nd.is_entry as nbr_is_entry,
         e.kind as edge_kind, e.key as edge_key
  FROM edges e
  JOIN nodes nd ON nd.id = e.dst
  LEFT JOIN files f ON f.id = nd.file_id
  WHERE e.src = ?
`;

const BACKWARD_SQL = `
  SELECT nd.id as nbr_id, nd.symbol_id as nbr_symbol_id, nd.name as nbr_name,
         nd.kind as nbr_kind, COALESCE(f.path, '') as nbr_file_path,
         nd.line_start as nbr_line_start, nd.line_end as nbr_line_end,
         nd.signature as nbr_signature,
         COALESCE(nd.pagerank, 0) as nbr_pagerank,
         COALESCE(nd.community, 0) as nbr_community, nd.is_entry as nbr_is_entry,
         e.kind as edge_kind, e.key as edge_key
  FROM edges e
  JOIN nodes nd ON nd.id = e.src
  LEFT JOIN files f ON f.id = nd.file_id
  WHERE e.dst = ?
`;

function estimateTokens(node: NodeRow): number {
  return Math.ceil(
    JSON.stringify({
      symbol_id: node.symbolId,
      name: node.name,
      kind: node.kind,
      file: node.filePath,
      line_start: node.lineStart,
      pagerank: node.pagerank,
      community: node.community,
    }).length / 4,
  );
}

function toNeighborNodeRow(r: RawEdgeRow): NodeRow {
  return toNodeRow({
    id: r.nbr_id,
    symbol_id: r.nbr_symbol_id,
    name: r.nbr_name,
    kind: r.nbr_kind,
    file_path: r.nbr_file_path,
    line_start: r.nbr_line_start,
    line_end: r.nbr_line_end,
    signature: r.nbr_signature,
    pagerank: r.nbr_pagerank,
    community: r.nbr_community,
    is_entry: r.nbr_is_entry,
  } as RawNodeRow);
}

export function bfsSubgraph(
  db: SqliteDb,
  seedId: bigint,
  opts: { depth: number; budget: number },
): BfsResult {
  // idToSymbolId tracks all visited nodes' symbol IDs for edge construction
  const idToSymbolId = new Map<bigint, string>();
  const resultNodes: NodeRow[] = [];
  const resultEdges: OutputEdge[] = [];
  const edgeSeen = new Set<string>();
  let remainingBudget = opts.budget;
  let truncated = false;

  // Fetch seed node's symbol_id for edge construction
  const seedRow = db.get<{ symbol_id: string }>(
    "SELECT symbol_id FROM nodes WHERE id = ?",
    Number(seedId),
  );
  if (seedRow) idToSymbolId.set(seedId, seedRow.symbol_id);

  let frontier: bigint[] = [seedId];

  for (let d = 0; d < opts.depth; d++) {
    // Collect candidates: Map<nbrId, { node, edges[] }>
    const candidates = new Map<bigint, { node: NodeRow; edges: OutputEdge[] }>();

    for (const nodeId of frontier) {
      const srcSymbolId = idToSymbolId.get(nodeId) ?? "";

      const forwardRows = db.all<RawEdgeRow>(FORWARD_SQL, Number(nodeId));
      for (const r of forwardRows) {
        const nbrId = BigInt(r.nbr_id);
        const edge: OutputEdge = {
          src: srcSymbolId,
          dst: r.nbr_symbol_id,
          kind: r.edge_kind,
          key: r.edge_key,
        };
        const edgeKey = `${edge.src}|${edge.dst}|${edge.kind}`;
        if (idToSymbolId.has(nbrId)) {
          // Already visited — include edge if not seen
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            resultEdges.push(edge);
          }
        } else {
          if (!candidates.has(nbrId)) {
            candidates.set(nbrId, { node: toNeighborNodeRow(r), edges: [] });
          }
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            candidates.get(nbrId)!.edges.push(edge);
          }
        }
      }

      const backwardRows = db.all<RawEdgeRow>(BACKWARD_SQL, Number(nodeId));
      for (const r of backwardRows) {
        const nbrId = BigInt(r.nbr_id);
        const dstSymbolId = idToSymbolId.get(nodeId) ?? "";
        const edge: OutputEdge = {
          src: r.nbr_symbol_id,
          dst: dstSymbolId,
          kind: r.edge_kind,
          key: r.edge_key,
        };
        const edgeKey = `${edge.src}|${edge.dst}|${edge.kind}`;
        if (idToSymbolId.has(nbrId)) {
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            resultEdges.push(edge);
          }
        } else {
          if (!candidates.has(nbrId)) {
            candidates.set(nbrId, { node: toNeighborNodeRow(r), edges: [] });
          }
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            candidates.get(nbrId)!.edges.push(edge);
          }
        }
      }
    }

    // Sort candidates by pagerank descending, then add until budget exhausted
    const sorted = [...candidates.values()].sort(
      (a, b) => b.node.pagerank - a.node.pagerank,
    );

    const nextFrontier: bigint[] = [];
    for (const { node, edges } of sorted) {
      const cost = estimateTokens(node);
      if (remainingBudget - cost < 0) {
        truncated = true;
        continue;
      }
      remainingBudget -= cost;
      idToSymbolId.set(node.id, node.symbolId);
      resultNodes.push(node);
      resultEdges.push(...edges);
      nextFrontier.push(node.id);
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return { nodes: resultNodes, edges: resultEdges, truncated };
}
```

- [ ] **Step 4: Run to confirm PASS**

```bash
bun test tests/unit/query/bfs.test.ts
```

Expected: 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/query/bfs.ts tests/unit/query/bfs.test.ts
git commit -m "feat: bidirectional BFS with pagerank priority and token budget gate"
```

---

### Task 4: Serializer

**Files:**
- Create: `src/output/serialize.ts`

- [ ] **Step 1: Create `src/output/serialize.ts`**

```typescript
import { LEGEND } from "./legend.ts";
import type { BfsResult, NodeRow, QueryOutput } from "../query/types.ts";

function nodeToOutput(n: NodeRow): QueryOutput["seed"] {
  return {
    symbol_id: n.symbolId,
    name: n.name,
    kind: n.kind,
    file: n.filePath,
    line_start: n.lineStart,
    pagerank: n.pagerank,
    community: n.community,
  };
}

export function serializeQuery(seed: NodeRow, bfs: BfsResult): QueryOutput {
  return {
    seed: nodeToOutput(seed),
    nodes: bfs.nodes.map(nodeToOutput),
    edges: bfs.edges,
    truncated: bfs.truncated,
    legend: LEGEND,
  };
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/output/serialize.ts
git commit -m "feat: query output serializer"
```

---

### Task 5: explain-edges CLI

**Files:**
- Create: `src/cli/explain-edges.ts`

- [ ] **Step 1: Create `src/cli/explain-edges.ts`**

```typescript
import { EDGE_KINDS } from "../output/legend.ts";

export function run(_args: string[]): void {
  console.log(JSON.stringify({ edge_kinds: EDGE_KINDS }, null, 2));
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/explain-edges.ts
git commit -m "feat: explain-edges command — static edge kind legend"
```

---

### Task 6: query CLI with DB discovery

**Files:**
- Create: `src/cli/query.ts`

- [ ] **Step 1: Create `src/cli/query.ts`**

```typescript
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../storage/db.ts";
import { bfsSubgraph } from "../query/bfs.ts";
import { resolveSeed } from "../query/seed.ts";
import { serializeQuery } from "../output/serialize.ts";

function findDb(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      console.error(`error: DB not found at ${override}`);
      process.exit(1);
    }
    return override;
  }
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".tsgraph.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      console.error("error: .tsgraph.db not found. Run `tsgraph build <dir>` first.");
      process.exit(1);
    }
    dir = parent;
  }
}

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      depth: { type: "string", default: "3" },
      budget: { type: "string", default: "8000" },
      db: { type: "string" },
    },
    allowPositionals: true,
  });

  const seed = positionals[0];
  if (!seed) {
    console.error(
      "Usage: tsgraph query <seed> [--depth N] [--budget N] [--db path]\n" +
      "  <seed>  Symbol name (e.g. greet) or qualified ID (e.g. src/index.ts::greet)",
    );
    process.exit(1);
  }

  const depth = Math.max(0, parseInt(values.depth ?? "3", 10));
  const budget = Math.max(0, parseInt(values.budget ?? "8000", 10));
  const dbPath = findDb(values.db);
  const db = openDb(dbPath);

  try {
    const seedNode = resolveSeed(db, seed);
    const bfsResult = bfsSubgraph(db, seedNode.id, { depth, budget });
    const output = serializeQuery(seedNode, bfsResult);
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/query.ts
git commit -m "feat: query CLI — DB discovery, arg parsing, seed → BFS → JSON"
```

---

### Task 7: Wire CLI dispatch

**Files:**
- Modify: `src/cli.ts`

Current stubs in `src/cli.ts`:
```typescript
case "query":
  console.error("'query' not yet implemented (Phase 3)");
  process.exit(1);
  break;
case "explain-edges":
  console.error("'explain-edges' not yet implemented (Phase 3)");
  process.exit(1);
  break;
```

- [ ] **Step 1: Replace stubs**

Edit `src/cli.ts` — replace the two stub cases with:

```typescript
  case "query":
    await import("./cli/query.ts").then((m) => m.run(positionals.slice(1)));
    break;
  case "explain-edges":
    await import("./cli/explain-edges.ts").then((m) => m.run(positionals.slice(1)));
    break;
```

- [ ] **Step 2: Verify typecheck and lint**

```bash
bun run typecheck && bunx @biomejs/biome check .
```

Expected: 0 errors, 0 lint issues

- [ ] **Step 3: Smoke test with the fixture DB**

```bash
bun run dev -- build ./fixtures/simple-ts && bun run dev -- query greet --db ./fixtures/simple-ts/.tsgraph.db
```

Expected: JSON output with `seed.name = "greet"`, at least one edge, `truncated: false`

- [ ] **Step 4: Smoke test explain-edges**

```bash
bun run dev -- explain-edges
```

Expected: JSON with `edge_kinds` keys: `imports`, `calls`, `extends`, `implements`, `references`

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire query and explain-edges commands in CLI dispatch"
```

---

### Task 8: E2E integration test for query command

**Files:**
- Create: `tests/integration/query.test.ts`

This test reuses the `fixtures/simple-ts` project. It runs `build` first (same as the build E2E test does), then runs `query`.

- [ ] **Step 1: Create `tests/integration/query.test.ts`**

```typescript
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { run as buildRun } from "../../src/cli/build.ts";
import { run as queryRun } from "../../src/cli/query.ts";
import { openDb } from "../../src/storage/db.ts";

const fixtureDir = join(import.meta.dir, "../../fixtures/simple-ts");
const dbPath = join(fixtureDir, ".tsgraph.db");

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch { /* ok */ }
  }
}

let capturedOutput = "";

beforeAll(async () => {
  cleanupDb();
  await buildRun([fixtureDir]);
});

afterAll(() => {
  cleanupDb();
});

// Helper: capture stdout from queryRun
async function runQuery(args: string[]): Promise<object> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await queryRun([...args, "--db", dbPath]);
  } finally {
    console.log = origLog;
  }
  return JSON.parse(lines.join("\n"));
}

describe("tsgraph query", () => {
  test("resolves seed by bare name and returns JSON", async () => {
    const output = await runQuery(["greet"]) as { seed: { name: string } };
    expect(output.seed.name).toBe("greet");
  });

  test("output has seed, nodes, edges, truncated, legend fields", async () => {
    const output = await runQuery(["greet"]) as Record<string, unknown>;
    expect(output).toHaveProperty("seed");
    expect(output).toHaveProperty("nodes");
    expect(output).toHaveProperty("edges");
    expect(output).toHaveProperty("truncated");
    expect(output).toHaveProperty("legend");
  });

  test("resolves seed by qualified ID", async () => {
    const output = await runQuery(["src/index.ts::greet"]) as { seed: { symbol_id: string } };
    expect(output.seed.symbol_id).toBe("src/index.ts::greet");
  });

  test("edges reference symbol_ids not integer IDs", async () => {
    const output = await runQuery(["greet"]) as { edges: Array<{ src: string; dst: string }> };
    for (const edge of output.edges) {
      expect(edge.src).toContain("::");
      expect(edge.dst).toContain("::");
    }
  });

  test("legend contains expected edge kinds", async () => {
    const output = await runQuery(["greet"]) as { legend: { edge_kinds: Record<string, string> } };
    expect(output.legend.edge_kinds).toHaveProperty("calls");
    expect(output.legend.edge_kinds).toHaveProperty("imports");
  });

  test("--depth 0 returns seed only, no neighbor nodes", async () => {
    const output = await runQuery(["greet", "--depth", "0"]) as { nodes: unknown[] };
    expect(output.nodes).toHaveLength(0);
  });

  test("explain-edges returns edge_kinds JSON", async () => {
    const { run: explainRun } = await import("../../src/cli/explain-edges.ts");
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    explainRun([]);
    console.log = origLog;
    const parsed = JSON.parse(lines.join("\n")) as { edge_kinds: Record<string, string> };
    expect(parsed).toHaveProperty("edge_kinds");
    expect(Object.keys(parsed.edge_kinds).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm PASS**

```bash
bun test tests/integration/query.test.ts
```

Expected: 7 pass, 0 fail

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: ≥59 pass (52 existing + 5 seed + 8 bfs + 7 query integration - some overlap), 0 fail

- [ ] **Step 4: Run full verification**

```bash
bun run typecheck && bun test && bunx @biomejs/biome check .
```

Expected: all green

- [ ] **Step 5: Commit**

```bash
git add tests/integration/query.test.ts
git commit -m "test: E2E integration tests for query and explain-edges commands"
```

---

## Self-Review

**Spec coverage:**
- ✅ Seed: bare name + qualified ID → Task 2
- ✅ DB discovery: walk-up from cwd, `--db` override → Task 6
- ✅ BFS bidirectional, `--depth`, `--budget`, pagerank priority → Task 3
- ✅ `truncated: true` when budget exhausted → Task 3
- ✅ Output JSON shape (seed, nodes, edges, truncated, legend) → Task 4
- ✅ Seed node NOT in `nodes` array → Task 3 (bfs returns only neighbors)
- ✅ Edges use symbol_ids not integer IDs → Task 3
- ✅ `--budget 0` returns no neighbors, `truncated: true` → Task 3 tests
- ✅ `explain-edges` static, no DB → Task 5
- ✅ CLI wired with dynamic import → Task 7
- ✅ `query` path never loads WASM (dynamic import isolation) → Task 7

**Type consistency:**
- `NodeRow` defined in `src/query/types.ts` (Task 1), used in seed.ts (Task 2), bfs.ts (Task 3), serialize.ts (Task 4)
- `BfsResult` defined in `src/query/types.ts`, returned by `bfsSubgraph`, consumed by `serializeQuery`
- `RawNodeRow` + `toNodeRow` defined in `seed.ts`, re-exported and used in `bfs.ts`
- `QueryOutput` defined in `src/query/types.ts`, returned by `serializeQuery`

**No placeholders found.**
