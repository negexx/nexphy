# Phase 2 — `build` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `tsgraph build <dir>` command — a chunked pipeline that parses TypeScript files with tree-sitter, resolves type edges with `ts.createProgram`, writes the graph to SQLite, runs PageRank, and assigns community IDs via native infomap CLI.

**Architecture:** CLI entry point dynamically imports `src/cli/build.ts` (command isolation, footprint Phase 1). The build pipeline processes files in configurable chunks of 200: tree-sitter pre-pass → TS compiler edge resolution → SQLite write → discard. After all chunks are done, PageRank and infomap run against the SQLite data (never concurrently with createProgram).

**Tech Stack:** Bun, TypeScript 6.0, web-tree-sitter 0.26 (WASM), `ts.createProgram` via `createRequire`, bun:sqlite, native infomap CLI subprocess.

---

## File Map

```
src/
├── cli.ts                        MODIFY — dynamic import dispatch
├── cli/
│   └── build.ts                  CREATE — build command orchestrator + arg parsing
├── config/
│   ├── types.ts                  CREATE — TsgraphConfig interface
│   └── loader.ts                 CREATE — tsgraph.toml parser with defaults
├── parser/
│   ├── types.ts                  CREATE — ParsedSymbol, ParsedImport, ParsedFile
│   ├── wasm.ts                   CREATE — WASM path resolver (dev + compiled modes)
│   ├── init.ts                   CREATE — Parser.init() singleton
│   └── extract.ts                CREATE — tree-sitter symbol + import extraction
├── analyzer/
│   ├── types.ts                  CREATE — ResolvedEdge, EdgeKind
│   └── resolve.ts                CREATE — ts.createProgram edge resolver
├── graph/
│   ├── types.ts                  CREATE — GraphNode, GraphEdge
│   └── builder.ts                CREATE — merge parser + analyzer output
├── pagerank/
│   └── compute.ts                CREATE — iterative PageRank, deterministic tie-break
├── community/
│   └── infomap.ts                CREATE — native infomap subprocess, graceful fallback
└── storage/
    └── writer.ts                 CREATE — upsert file/node/edge, update rank/community

tests/
├── unit/
│   ├── config.test.ts            CREATE
│   ├── writer.test.ts            CREATE
│   ├── extract.test.ts           CREATE
│   ├── dirty.test.ts             CREATE
│   ├── pagerank.test.ts          CREATE
│   └── builder.test.ts           CREATE
└── integration/
    └── build.test.ts             CREATE — e2e against fixture TS project
fixtures/
    └── simple-ts/                CREATE — minimal TypeScript project for tests
        ├── src/
        │   ├── index.ts
        │   └── utils.ts
        └── tsconfig.json
```

---

## Task 1: CLI dynamic import refactor (footprint Phase 1)

**Files:**
- Modify: `src/cli.ts`
- Create: `src/cli/build.ts` (stub — wired up fully in Task 11)

- [ ] **Step 1: Update `src/cli.ts` to dispatch via dynamic import**

Replace the switch body with dynamic imports so `query` never loads tree-sitter or the TS compiler:

```typescript
// src/cli.ts
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.version) {
  console.log("tsgraph 0.1.0");
  process.exit(0);
}

if (values.help || positionals.length === 0) {
  console.log(`
tsgraph — TypeScript Code Graph CLI

Usage:
  tsgraph build <dir>     Build the knowledge graph for a TypeScript project
  tsgraph query <seed>    Query the graph around a symbol
  tsgraph explain-edges   Show how framework edges are detected

Options:
  -v, --version  Show version
  -h, --help     Show this help
`);
  process.exit(0);
}

const [command] = positionals;
switch (command) {
  case "build":
    await import("./cli/build.ts").then((m) => m.run(positionals.slice(1)));
    break;
  case "query":
    console.error("'query' not yet implemented (Phase 3)");
    process.exit(1);
    break;
  case "explain-edges":
    console.error("'explain-edges' not yet implemented (Phase 3)");
    process.exit(1);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
```

- [ ] **Step 2: Create the `src/cli/build.ts` stub**

```typescript
// src/cli/build.ts
export async function run(_args: string[]): Promise<void> {
  console.error("'build' not yet implemented (Task 11)");
  process.exit(1);
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 4: Verify lint passes**

```bash
bunx @biomejs/biome check .
```
Expected: no errors or warnings.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli/build.ts
git commit -m "refactor: command isolation via dynamic import (footprint phase 1)"
```

---

## Task 2: Config types and TOML loader

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/loader.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/config.test.ts
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config/loader.ts";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempDir(): string {
  const dir = join(tmpdir(), `tsgraph-cfg-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  test("returns defaults when no tsgraph.toml exists", () => {
    const dir = makeTempDir();
    const cfg = loadConfig(dir);
    expect(cfg.chunkSize).toBe(200);
    expect(cfg.include).toContain("**/*.ts");
    expect(cfg.exclude).toContain("node_modules/**");
    rmSync(dir, { recursive: true });
  });

  test("merges toml values over defaults", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "tsgraph.toml"), `
[build]
chunk_size = 50
`);
    const cfg = loadConfig(dir);
    expect(cfg.chunkSize).toBe(50);
    expect(cfg.include).toContain("**/*.ts");
    rmSync(dir, { recursive: true });
  });

  test("custom include patterns replace defaults", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "tsgraph.toml"), `
[include]
patterns = ["src/**/*.ts"]
`);
    const cfg = loadConfig(dir);
    expect(cfg.include).toEqual(["src/**/*.ts"]);
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/unit/config.test.ts
```
Expected: FAIL — `loadConfig` not found.

- [ ] **Step 3: Create `src/config/types.ts`**

```typescript
// src/config/types.ts
export interface TsgraphConfig {
  chunkSize: number;
  include: string[];
  exclude: string[];
}

export const CONFIG_DEFAULTS: TsgraphConfig = {
  chunkSize: 200,
  include: ["**/*.ts"],
  exclude: ["node_modules/**", "dist/**", "**/*.test.ts", "**/*.spec.ts"],
};
```

- [ ] **Step 4: Create `src/config/loader.ts`**

Bun has a built-in `Bun.TOML.parse()`. Use it directly.

```typescript
// src/config/loader.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TsgraphConfig } from "./types.ts";
import { CONFIG_DEFAULTS } from "./types.ts";

export function loadConfig(projectDir: string): TsgraphConfig {
  const tomlPath = join(projectDir, "tsgraph.toml");
  if (!existsSync(tomlPath)) return { ...CONFIG_DEFAULTS };

  const raw = Bun.TOML.parse(readFileSync(tomlPath, "utf8")) as Record<string, unknown>;
  const build = (raw.build ?? {}) as Record<string, unknown>;
  const include = (raw.include ?? {}) as Record<string, unknown>;
  const exclude = (raw.exclude ?? {}) as Record<string, unknown>;

  return {
    chunkSize:
      typeof build.chunk_size === "number" ? build.chunk_size : CONFIG_DEFAULTS.chunkSize,
    include: Array.isArray(include.patterns)
      ? (include.patterns as string[])
      : CONFIG_DEFAULTS.include,
    exclude: Array.isArray(exclude.patterns)
      ? (exclude.patterns as string[])
      : CONFIG_DEFAULTS.exclude,
  };
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
bun test tests/unit/config.test.ts
```
Expected: 3 pass.

- [ ] **Step 6: Typecheck + lint**

```bash
bun run typecheck && bunx @biomejs/biome check .
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/config/ tests/unit/config.test.ts
git commit -m "feat: tsgraph.toml config loader with defaults"
```

---

## Task 3: Storage writer (upsert nodes, edges, files)

**Files:**
- Create: `src/storage/writer.ts`
- Create: `tests/unit/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/writer.test.ts
import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/storage/db.ts";
import {
  upsertFile,
  upsertNode,
  upsertEdge,
  updatePagerank,
  updateCommunity,
} from "../../src/storage/writer.ts";

function makeTempDb() {
  const path = join(tmpdir(), `tsgraph-writer-${Date.now()}.db`);
  return { path, db: openDb(path) };
}
function cleanup(path: string) {
  for (const s of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + s); } catch { /* ok */ }
  }
}

describe("upsertFile", () => {
  test("inserts a new file and returns its id", () => {
    const { path, db } = makeTempDb();
    const id = upsertFile(db, { path: "src/index.ts", contentHash: "abc", shapeHash: "def", analyzedAt: 1000 });
    expect(typeof id).toBe("bigint");
    expect(id).toBeGreaterThan(0n);
    db.close(); cleanup(path);
  });

  test("upserts (replaces) on conflict", () => {
    const { path, db } = makeTempDb();
    const id1 = upsertFile(db, { path: "src/index.ts", contentHash: "abc", shapeHash: "def", analyzedAt: 1000 });
    const id2 = upsertFile(db, { path: "src/index.ts", contentHash: "xyz", shapeHash: "uvw", analyzedAt: 2000 });
    expect(id1).toBe(id2);
    db.close(); cleanup(path);
  });
});

describe("upsertNode", () => {
  test("inserts a node and returns its id", () => {
    const { path, db } = makeTempDb();
    const fileId = upsertFile(db, { path: "src/a.ts", contentHash: "h", shapeHash: "s", analyzedAt: 1 });
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
    db.close(); cleanup(path);
  });
});

describe("upsertEdge", () => {
  test("inserts an edge between two nodes", () => {
    const { path, db } = makeTempDb();
    const fid = upsertFile(db, { path: "src/a.ts", contentHash: "h", shapeHash: "s", analyzedAt: 1 });
    const src = upsertNode(db, { symbolId: "src/a.ts#A", name: "A", kind: "function", fileId: fid, lineStart: 1, lineEnd: 1, signature: null, isEntry: false });
    const dst = upsertNode(db, { symbolId: "src/a.ts#B", name: "B", kind: "function", fileId: fid, lineStart: 2, lineEnd: 2, signature: null, isEntry: false });
    upsertEdge(db, { srcId: src, dstId: dst, kind: "calls", key: null });
    const edges = db.all<{ src: number; dst: number }>("SELECT src, dst FROM edges");
    expect(edges).toHaveLength(1);
    db.close(); cleanup(path);
  });

  test("ignores duplicate (src, dst, kind) edges", () => {
    const { path, db } = makeTempDb();
    const fid = upsertFile(db, { path: "src/a.ts", contentHash: "h", shapeHash: "s", analyzedAt: 1 });
    const src = upsertNode(db, { symbolId: "src/a.ts#A", name: "A", kind: "function", fileId: fid, lineStart: 1, lineEnd: 1, signature: null, isEntry: false });
    const dst = upsertNode(db, { symbolId: "src/a.ts#B", name: "B", kind: "function", fileId: fid, lineStart: 2, lineEnd: 2, signature: null, isEntry: false });
    upsertEdge(db, { srcId: src, dstId: dst, kind: "calls", key: null });
    upsertEdge(db, { srcId: src, dstId: dst, kind: "calls", key: null });
    const edges = db.all("SELECT * FROM edges");
    expect(edges).toHaveLength(1);
    db.close(); cleanup(path);
  });
});

describe("updatePagerank / updateCommunity", () => {
  test("updates node rank and community without error", () => {
    const { path, db } = makeTempDb();
    const fid = upsertFile(db, { path: "src/a.ts", contentHash: "h", shapeHash: "s", analyzedAt: 1 });
    const nid = upsertNode(db, { symbolId: "src/a.ts#A", name: "A", kind: "function", fileId: fid, lineStart: 1, lineEnd: 1, signature: null, isEntry: false });
    updatePagerank(db, nid, 0.42);
    updateCommunity(db, nid, 7);
    const row = db.get<{ pagerank: number; community: number }>("SELECT pagerank, community FROM nodes WHERE id = ?", Number(nid));
    expect(row?.pagerank).toBeCloseTo(0.42);
    expect(row?.community).toBe(7);
    db.close(); cleanup(path);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/unit/writer.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/storage/writer.ts`**

```typescript
// src/storage/writer.ts
import type { SqliteDb } from "./interface.ts";

export interface FileRecord {
  path: string;
  contentHash: string;
  shapeHash: string;
  analyzedAt: number;
}

export interface NodeRecord {
  symbolId: string;
  name: string;
  kind: string;
  fileId: bigint;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  isEntry: boolean;
}

export interface EdgeRecord {
  srcId: bigint;
  dstId: bigint;
  kind: string;
  key: string | null;
}

export function upsertFile(db: SqliteDb, f: FileRecord): bigint {
  const existing = db.get<{ id: number }>(
    "SELECT id FROM files WHERE path = ?",
    f.path,
  );
  if (existing) {
    db.run(
      "UPDATE files SET content_hash=?, shape_hash=?, analyzed_at=? WHERE id=?",
      f.contentHash, f.shapeHash, f.analyzedAt, existing.id,
    );
    return BigInt(existing.id);
  }
  const r = db.run(
    "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?,?,?,?)",
    f.path, f.contentHash, f.shapeHash, f.analyzedAt,
  );
  return r.lastInsertRowid;
}

export function upsertNode(db: SqliteDb, n: NodeRecord): bigint {
  const existing = db.get<{ id: number }>(
    "SELECT id FROM nodes WHERE symbol_id = ?",
    n.symbolId,
  );
  if (existing) {
    db.run(
      `UPDATE nodes SET name=?, kind=?, file_id=?, line_start=?, line_end=?,
       signature=?, is_entry=? WHERE id=?`,
      n.name, n.kind, Number(n.fileId), n.lineStart, n.lineEnd,
      n.signature, n.isEntry ? 1 : 0, existing.id,
    );
    return BigInt(existing.id);
  }
  const r = db.run(
    `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, line_end, signature, is_entry)
     VALUES (?,?,?,?,?,?,?,?)`,
    n.symbolId, n.name, n.kind, Number(n.fileId),
    n.lineStart, n.lineEnd, n.signature, n.isEntry ? 1 : 0,
  );
  return r.lastInsertRowid;
}

export function upsertEdge(db: SqliteDb, e: EdgeRecord): void {
  db.run(
    `INSERT OR IGNORE INTO edges (src, dst, kind, key) VALUES (?,?,?,?)`,
    Number(e.srcId), Number(e.dstId), e.kind, e.key,
  );
}

export function updatePagerank(db: SqliteDb, nodeId: bigint, rank: number): void {
  db.run("UPDATE nodes SET pagerank=? WHERE id=?", rank, Number(nodeId));
}

export function updateCommunity(db: SqliteDb, nodeId: bigint, community: number): void {
  db.run("UPDATE nodes SET community=? WHERE id=?", community, Number(nodeId));
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/writer.test.ts
```
Expected: all pass.

- [ ] **Step 5: Typecheck + lint**

```bash
bun run typecheck && bunx @biomejs/biome check .
```

- [ ] **Step 6: Commit**

```bash
git add src/storage/writer.ts tests/unit/writer.test.ts
git commit -m "feat: storage writer — upsert file/node/edge, update pagerank/community"
```

---

## Task 4: WASM path resolver and Parser singleton

**Files:**
- Create: `src/parser/types.ts`
- Create: `src/parser/wasm.ts`
- Create: `src/parser/init.ts`

No unit tests here — WASM loading is integration-level. The prototype already validated this path. We extract and harden the logic from `prototypes/tree-sitter-bun.ts`.

- [ ] **Step 1: Create `src/parser/types.ts`**

```typescript
// src/parser/types.ts
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "variable";

export interface ParsedSymbol {
  symbolId: string;       // "posix/path/file.ts#Name" — unique per file+name
  name: string;
  kind: SymbolKind;
  filePath: string;       // POSIX-normalized
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  isEntry: boolean;       // true if exported at module level
}

export interface ParsedImport {
  fromFile: string;       // POSIX-normalized absolute path
  toSpecifier: string;    // raw import specifier e.g. "./utils" or "typescript"
  names: string[];        // ["default"] for default import, named imports otherwise
}

export interface ParsedFile {
  path: string;           // POSIX-normalized absolute path
  contentHash: string;    // SHA-1 of raw file content
  shapeHash: string;      // SHA-1 of sorted symbolIds (structural fingerprint)
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
}
```

- [ ] **Step 2: Create `src/parser/wasm.ts`**

Extracted directly from the prototype with compilation-mode guard:

```typescript
// src/parser/wasm.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const isCompiled = !process.execPath.endsWith("bun") &&
  !process.execPath.endsWith("bun.exe");

function candidates(filename: string): string[] {
  const execDir = dirname(process.execPath);
  if (isCompiled) {
    // Compiled binary: WASM must be a sidecar next to the executable.
    // process.cwd() is the user's arbitrary directory — not safe to use.
    return [join(execDir, filename)];
  }
  return [
    join(process.cwd(), "node_modules/web-tree-sitter", filename),
    join(process.cwd(), "node_modules/tree-sitter-typescript", filename),
    join(import.meta.dir, "../node_modules/web-tree-sitter", filename),
    join(import.meta.dir, "../node_modules/tree-sitter-typescript", filename),
  ];
}

export function findWasm(filename: string): string {
  for (const p of candidates(filename)) {
    if (existsSync(p)) return p;
  }
  const searched = candidates(filename).join("\n  ");
  throw new Error(
    `Cannot find ${filename}. In compiled mode, place WASM sidecars next to the binary.\nSearched:\n  ${searched}`,
  );
}

export function readWasm(filename: string): Uint8Array {
  return readFileSync(findWasm(filename));
}
```

- [ ] **Step 3: Create `src/parser/init.ts`**

```typescript
// src/parser/init.ts
import { Language, Parser } from "web-tree-sitter";
import { readWasm } from "./wasm.ts";

let parser: Parser | null = null;
let tsLanguage: Language | null = null;

export async function getParser(): Promise<{ parser: Parser; language: Language }> {
  if (parser && tsLanguage) return { parser, language: tsLanguage };

  await Parser.init({ wasmBinary: readWasm("tree-sitter.wasm") });
  tsLanguage = await Language.load(readWasm("tree-sitter-typescript.wasm"));
  parser = new Parser();
  parser.setLanguage(tsLanguage);

  return { parser, language: tsLanguage };
}
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/parser/types.ts src/parser/wasm.ts src/parser/init.ts
git commit -m "feat: WASM resolver + Parser singleton (dev + compiled mode)"
```

---

## Task 5: Symbol and import extractor

**Files:**
- Create: `src/parser/extract.ts`
- Create: `tests/unit/extract.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/extract.test.ts
import { describe, expect, test } from "bun:test";
import { extractFile } from "../../src/parser/extract.ts";

const FIXTURE_TS = `
import { readFileSync } from "node:fs";
import type { Foo } from "./foo.ts";

export function greet(name: string): string {
  return "hello " + name;
}

export class Greeter {
  greet(name: string) { return greet(name); }
}

export interface Options {
  verbose: boolean;
}

export type Result = string | null;

const internal = () => {};
`.trim();

describe("extractFile", () => {
  test("extracts exported function", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const fn = file.symbols.find((s) => s.name === "greet");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.isEntry).toBe(true);
    expect(fn?.symbolId).toBe("src/index.ts#greet");
  });

  test("extracts exported class", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const cls = file.symbols.find((s) => s.name === "Greeter");
    expect(cls?.kind).toBe("class");
    expect(cls?.isEntry).toBe(true);
  });

  test("extracts exported interface", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const iface = file.symbols.find((s) => s.name === "Options");
    expect(iface?.kind).toBe("interface");
    expect(iface?.isEntry).toBe(true);
  });

  test("extracts exported type alias", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const t = file.symbols.find((s) => s.name === "Result");
    expect(t?.kind).toBe("type");
    expect(t?.isEntry).toBe(true);
  });

  test("non-exported symbol has isEntry=false", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const internal = file.symbols.find((s) => s.name === "internal");
    expect(internal?.isEntry).toBe(false);
  });

  test("extracts value imports", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const fsImport = file.imports.find((i) => i.toSpecifier === "node:fs");
    expect(fsImport).toBeDefined();
    expect(fsImport?.names).toContain("readFileSync");
  });

  test("computes contentHash as hex string", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    expect(file.contentHash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("computes shapeHash deterministically", async () => {
    const a = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const b = await extractFile("/project/src/index.ts", FIXTURE_TS);
    expect(a.shapeHash).toBe(b.shapeHash);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/unit/extract.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/parser/extract.ts`**

Walk top-level nodes of the tree-sitter AST. Export detection: a node is exported if its parent is an `export_statement`.

```typescript
// src/parser/extract.ts
import { createHash } from "node:crypto";
import type { SyntaxNode } from "web-tree-sitter";
import { getParser } from "./init.ts";
import type { ParsedFile, ParsedImport, ParsedSymbol, SymbolKind } from "./types.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function stripProjectRoot(absPath: string, projectRoot: string): string {
  const norm = posix(absPath);
  const root = posix(projectRoot).replace(/\/$/, "");
  return norm.startsWith(root + "/") ? norm.slice(root.length + 1) : norm;
}

function kindOf(nodeType: string): SymbolKind | null {
  switch (nodeType) {
    case "function_declaration":
    case "function":
      return "function";
    case "class_declaration":
      return "class";
    case "interface_declaration":
      return "interface";
    case "type_alias_declaration":
      return "type";
    case "enum_declaration":
      return "enum";
    case "lexical_declaration":
    case "variable_declaration":
      return "const";
    default:
      return null;
  }
}

function getName(node: SyntaxNode): string | null {
  const nameNode =
    node.childForFieldName("name") ??
    node.children
      .find((c) => c.type === "variable_declarator")
      ?.childForFieldName("name");
  return nameNode?.text ?? null;
}

function extractImports(root: SyntaxNode, absPath: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  for (const child of root.children) {
    if (child.type !== "import_declaration") continue;
    const sourceNode = child.childForFieldName("source");
    if (!sourceNode) continue;
    const specifier = sourceNode.text.replace(/^["']|["']$/g, "");
    const names: string[] = [];
    const clause = child.children.find((c) => c.type === "import_clause");
    if (clause) {
      const named = clause.children.find((c) => c.type === "named_imports");
      if (named) {
        for (const spec of named.children) {
          if (spec.type === "import_specifier") {
            const n = spec.childForFieldName("name")?.text;
            if (n) names.push(n);
          }
        }
      }
      const defaultImport = clause.children.find((c) => c.type === "identifier");
      if (defaultImport) names.push("default");
    }
    imports.push({ fromFile: posix(absPath), toSpecifier: specifier, names });
  }
  return imports;
}

export async function extractFile(
  absPath: string,
  source: string,
  projectRoot = "/",
): Promise<ParsedFile> {
  const { parser } = await getParser();
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const relPath = stripProjectRoot(absPath, projectRoot);
  const symbols: ParsedSymbol[] = [];
  const usedNames = new Map<string, number>();

  for (const child of root.children) {
    let decl = child;
    let isEntry = false;

    if (child.type === "export_statement") {
      isEntry = true;
      const inner = child.children.find(
        (c) => c.type !== "export" && c.type !== "default" && kindOf(c.type) !== null,
      );
      if (!inner) continue;
      decl = inner;
    }

    const kind = kindOf(decl.type);
    if (!kind) continue;
    const name = getName(decl);
    if (!name) continue;

    const count = usedNames.get(name) ?? 0;
    usedNames.set(name, count + 1);
    const symbolId = count === 0 ? `${relPath}#${name}` : `${relPath}#${name}_${decl.startPosition.row + 1}`;

    symbols.push({
      symbolId,
      name,
      kind,
      filePath: posix(absPath),
      lineStart: decl.startPosition.row + 1,
      lineEnd: decl.endPosition.row + 1,
      signature: decl.text.split("\n")[0].slice(0, 200),
      isEntry,
    });
  }

  const imports = extractImports(root, absPath);

  const contentHash = createHash("sha1").update(source).digest("hex");
  const shapeHash = createHash("sha1")
    .update(symbols.map((s) => s.symbolId).sort().join("\n"))
    .digest("hex");

  return { path: posix(absPath), contentHash, shapeHash, symbols, imports };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/extract.test.ts
```
Expected: all pass. If any tree-sitter node types differ, inspect with `tree.rootNode.toString()` and fix the `kindOf` / `getName` mappings.

- [ ] **Step 5: Typecheck + lint**

```bash
bun run typecheck && bunx @biomejs/biome check .
```

- [ ] **Step 6: Commit**

```bash
git add src/parser/extract.ts tests/unit/extract.test.ts
git commit -m "feat: tree-sitter symbol + import extractor"
```

---

## Task 6: Dirty detection (skip unchanged files)

**Files:**
- Create: `tests/unit/dirty.test.ts`
- Modify: `src/storage/writer.ts` — add `getFileRecord`
- No new source file needed; dirty check is a comparison in the orchestrator. The test validates the hash contract.

- [ ] **Step 1: Add `getFileRecord` to `src/storage/writer.ts`**

```typescript
// append to src/storage/writer.ts
export interface StoredFileRecord {
  id: bigint;
  contentHash: string;
  shapeHash: string;
}

export function getFileRecord(db: SqliteDb, posixPath: string): StoredFileRecord | null {
  const row = db.get<{ id: number; content_hash: string; shape_hash: string }>(
    "SELECT id, content_hash, shape_hash FROM files WHERE path = ?",
    posixPath,
  );
  if (!row) return null;
  return { id: BigInt(row.id), contentHash: row.content_hash, shapeHash: row.shape_hash };
}

export function isDirty(stored: StoredFileRecord, parsed: { contentHash: string; shapeHash: string }): boolean {
  return stored.contentHash !== parsed.contentHash || stored.shapeHash !== parsed.shapeHash;
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// tests/unit/dirty.test.ts
import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/storage/db.ts";
import { upsertFile, getFileRecord, isDirty } from "../../src/storage/writer.ts";

function makeTempDb() {
  const path = join(tmpdir(), `tsgraph-dirty-${Date.now()}.db`);
  return { path, db: openDb(path) };
}
function cleanup(path: string) {
  for (const s of ["", "-wal", "-shm"]) { try { unlinkSync(path + s); } catch { /* ok */ } }
}

describe("dirty detection", () => {
  test("file not in DB → no record", () => {
    const { path, db } = makeTempDb();
    expect(getFileRecord(db, "src/new.ts")).toBeNull();
    db.close(); cleanup(path);
  });

  test("unchanged file → isDirty returns false", () => {
    const { path, db } = makeTempDb();
    upsertFile(db, { path: "src/a.ts", contentHash: "c1", shapeHash: "s1", analyzedAt: 1 });
    const stored = getFileRecord(db, "src/a.ts")!;
    expect(isDirty(stored, { contentHash: "c1", shapeHash: "s1" })).toBe(false);
    db.close(); cleanup(path);
  });

  test("changed content → isDirty returns true", () => {
    const { path, db } = makeTempDb();
    upsertFile(db, { path: "src/a.ts", contentHash: "c1", shapeHash: "s1", analyzedAt: 1 });
    const stored = getFileRecord(db, "src/a.ts")!;
    expect(isDirty(stored, { contentHash: "c2", shapeHash: "s1" })).toBe(true);
    db.close(); cleanup(path);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test tests/unit/dirty.test.ts
```
Expected: FAIL — `getFileRecord` and `isDirty` not exported.

- [ ] **Step 4: Run tests after adding to writer**

```bash
bun test tests/unit/dirty.test.ts
```
Expected: all pass.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
bun run typecheck && bunx @biomejs/biome check .
git add src/storage/writer.ts tests/unit/dirty.test.ts
git commit -m "feat: dirty detection helpers — getFileRecord, isDirty"
```

---

## Task 7: TypeScript analyzer (edge resolution via `ts.createProgram`)

**Files:**
- Create: `src/analyzer/types.ts`
- Create: `src/analyzer/resolve.ts`

No unit tests for the analyzer — `ts.createProgram` is too heavyweight for unit tests (requires a real tsconfig + files). Covered by the integration test in Task 12.

- [ ] **Step 1: Create `src/analyzer/types.ts`**

```typescript
// src/analyzer/types.ts
export type EdgeKind =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "uses-type"
  | "re-exports";

export interface ResolvedEdge {
  srcSymbolId: string;
  dstSymbolId: string;
  kind: EdgeKind;
  key: string | null;
}
```

- [ ] **Step 2: Create `src/analyzer/resolve.ts`**

Uses `createRequire(packageDir)` so the TypeScript compiler is resolved relative to the analyzed project, not tsgraph itself.

```typescript
// src/analyzer/resolve.ts
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ResolvedEdge } from "./types.ts";
import type { ParsedFile } from "../parser/types.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function relSymbolId(absPath: string, projectRoot: string, name: string): string {
  const root = posix(projectRoot).replace(/\/$/, "");
  const rel = posix(absPath).startsWith(root + "/")
    ? posix(absPath).slice(root.length + 1)
    : posix(absPath);
  return `${rel}#${name}`;
}

export async function resolveEdges(
  files: ParsedFile[],
  projectRoot: string,
): Promise<ResolvedEdge[]> {
  const req = createRequire(join(projectRoot, "package.json"));
  // biome-ignore lint/suspicious/noExplicitAny: dynamic require for cross-project TS
  const ts = req("typescript") as typeof import("typescript");

  const tsconfig = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  const configFile = tsconfig
    ? ts.readConfigFile(tsconfig, ts.sys.readFile)
    : { config: {} };
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectRoot,
    { noEmit: true, plugins: [] },  // always disable plugins (security)
  );

  const program = ts.createProgram({
    rootNames: files.map((f) => f.path.replace(/\//g, process.platform === "win32" ? "\\" : "/")),
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const edges: ResolvedEdge[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const filePath = posix(sourceFile.fileName);
    if (!files.some((f) => posix(f.path) === filePath)) continue;

    ts.forEachChild(sourceFile, function visit(node) {
      // Import edges
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const resolved = checker.getSymbolAtLocation(node.moduleSpecifier);
        const decls = resolved?.declarations;
        if (decls?.length) {
          const dstFile = posix(decls[0].getSourceFile().fileName);
          edges.push({
            srcSymbolId: `${filePath}#<module>`,
            dstSymbolId: `${dstFile}#<module>`,
            kind: "imports",
            key: null,
          });
        }
      }

      // Call expression edges
      if (ts.isCallExpression(node)) {
        const sym = checker.getSymbolAtLocation(node.expression);
        const decls = sym?.declarations;
        if (decls?.length) {
          const decl = decls[0];
          const dstFile = posix(decl.getSourceFile().fileName);
          const dstName = sym?.name ?? "unknown";
          edges.push({
            srcSymbolId: `${filePath}#<module>`,
            dstSymbolId: `${dstFile}#${dstName}`,
            kind: "calls",
            key: null,
          });
        }
      }

      // Heritage edges (extends / implements)
      if (ts.isHeritageClause(node)) {
        for (const expr of node.types) {
          const sym = checker.getSymbolAtLocation(expr.expression);
          const decls = sym?.declarations;
          if (decls?.length) {
            const dstFile = posix(decls[0].getSourceFile().fileName);
            const kind = node.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
            edges.push({
              srcSymbolId: `${filePath}#<module>`,
              dstSymbolId: `${dstFile}#${sym?.name ?? "unknown"}`,
              kind,
              key: null,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    });
  }

  // Allow GC of the program before returning (infomap constraint)
  return edges;
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/analyzer/types.ts src/analyzer/resolve.ts
git commit -m "feat: ts.createProgram edge resolver — imports, calls, extends, implements"
```

---

## Task 8: Graph builder (merge symbols + edges)

**Files:**
- Create: `src/graph/types.ts`
- Create: `src/graph/builder.ts`
- Create: `tests/unit/builder.test.ts`

- [ ] **Step 1: Create `src/graph/types.ts`**

```typescript
// src/graph/types.ts
import type { SymbolKind } from "../parser/types.ts";
import type { EdgeKind } from "../analyzer/types.ts";

export interface GraphNode {
  symbolId: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  fileId: bigint;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  isEntry: boolean;
}

export interface GraphEdge {
  srcSymbolId: string;
  dstSymbolId: string;
  kind: EdgeKind;
  key: string | null;
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// tests/unit/builder.test.ts
import { describe, expect, test } from "bun:test";
import { buildGraph } from "../../src/graph/builder.ts";
import type { ParsedFile } from "../../src/parser/types.ts";
import type { ResolvedEdge } from "../../src/analyzer/types.ts";

const FILE_A: ParsedFile = {
  path: "src/a.ts",
  contentHash: "c1",
  shapeHash: "s1",
  symbols: [
    { symbolId: "src/a.ts#foo", name: "foo", kind: "function", filePath: "src/a.ts", lineStart: 1, lineEnd: 3, signature: "function foo()", isEntry: true },
  ],
  imports: [],
};

const FILE_B: ParsedFile = {
  path: "src/b.ts",
  contentHash: "c2",
  shapeHash: "s2",
  symbols: [
    { symbolId: "src/b.ts#bar", name: "bar", kind: "function", filePath: "src/b.ts", lineStart: 1, lineEnd: 2, signature: "function bar()", isEntry: false },
  ],
  imports: [{ fromFile: "src/b.ts", toSpecifier: "./a", names: ["foo"] }],
};

const EDGES: ResolvedEdge[] = [
  { srcSymbolId: "src/b.ts#bar", dstSymbolId: "src/a.ts#foo", kind: "calls", key: null },
];

const FILE_IDS = new Map<string, bigint>([["src/a.ts", 1n], ["src/b.ts", 2n]]);

describe("buildGraph", () => {
  test("collects all symbols as nodes", () => {
    const { nodes } = buildGraph([FILE_A, FILE_B], EDGES, FILE_IDS);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.symbolId)).toContain("src/a.ts#foo");
    expect(nodes.map((n) => n.symbolId)).toContain("src/b.ts#bar");
  });

  test("attaches fileId from map", () => {
    const { nodes } = buildGraph([FILE_A, FILE_B], EDGES, FILE_IDS);
    const foo = nodes.find((n) => n.symbolId === "src/a.ts#foo");
    expect(foo?.fileId).toBe(1n);
  });

  test("includes resolved edges", () => {
    const { edges } = buildGraph([FILE_A, FILE_B], EDGES, FILE_IDS);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("calls");
  });

  test("deduplicates edges with same (src, dst, kind)", () => {
    const dup = [...EDGES, ...EDGES];
    const { edges } = buildGraph([FILE_A, FILE_B], dup, FILE_IDS);
    expect(edges).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test tests/unit/builder.test.ts
```

- [ ] **Step 4: Create `src/graph/builder.ts`**

```typescript
// src/graph/builder.ts
import type { ParsedFile } from "../parser/types.ts";
import type { ResolvedEdge } from "../analyzer/types.ts";
import type { GraphEdge, GraphNode } from "./types.ts";

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGraph(
  files: ParsedFile[],
  resolvedEdges: ResolvedEdge[],
  fileIds: Map<string, bigint>,
): Graph {
  const nodes: GraphNode[] = [];

  for (const file of files) {
    const fileId = fileIds.get(file.path) ?? 0n;
    for (const sym of file.symbols) {
      nodes.push({
        symbolId: sym.symbolId,
        name: sym.name,
        kind: sym.kind,
        filePath: sym.filePath,
        fileId,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        signature: sym.signature,
        isEntry: sym.isEntry,
      });
    }
  }

  // Deduplicate edges by (src, dst, kind)
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of resolvedEdges) {
    const key = `${e.srcSymbolId}|${e.dstSymbolId}|${e.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(e);
    }
  }

  return { nodes, edges };
}
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/unit/builder.test.ts
```
Expected: all pass.

- [ ] **Step 6: Typecheck + lint + commit**

```bash
bun run typecheck && bunx @biomejs/biome check .
git add src/graph/ tests/unit/builder.test.ts
git commit -m "feat: graph builder — merge parsed symbols + resolved edges, deduplicate"
```

---

## Task 9: PageRank computation

**Files:**
- Create: `src/pagerank/compute.ts`
- Create: `tests/unit/pagerank.test.ts`

PageRank where nodes with many in-edges (things called by many other things) rank highest. Damping factor 0.85. Tie-break by node ID (ascending) for determinism.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/pagerank.test.ts
import { describe, expect, test } from "bun:test";
import { computePagerank } from "../../src/pagerank/compute.ts";

describe("computePagerank", () => {
  test("all nodes receive positive rank", () => {
    const edges = [{ src: 1n, dst: 2n }, { src: 1n, dst: 3n }];
    const ranks = computePagerank([1n, 2n, 3n], edges);
    for (const [, r] of ranks) expect(r).toBeGreaterThan(0);
  });

  test("node with more in-edges ranks higher", () => {
    // 1→3, 2→3, 1→2: node 3 has 2 in-edges, node 2 has 1
    const edges = [{ src: 1n, dst: 3n }, { src: 2n, dst: 3n }, { src: 1n, dst: 2n }];
    const ranks = computePagerank([1n, 2n, 3n], edges);
    expect(ranks.get(3n)!).toBeGreaterThan(ranks.get(2n)!);
  });

  test("is deterministic across calls", () => {
    const edges = [{ src: 1n, dst: 2n }];
    const a = computePagerank([1n, 2n], edges);
    const b = computePagerank([1n, 2n], edges);
    expect(a.get(1n)).toBeCloseTo(b.get(1n)!, 10);
    expect(a.get(2n)).toBeCloseTo(b.get(2n)!, 10);
  });

  test("isolated node still gets a rank", () => {
    const ranks = computePagerank([1n, 2n], []);
    expect(ranks.get(1n)).toBeGreaterThan(0);
    expect(ranks.get(2n)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test tests/unit/pagerank.test.ts
```

- [ ] **Step 3: Create `src/pagerank/compute.ts`**

```typescript
// src/pagerank/compute.ts
const DAMPING = 0.85;
const ITERATIONS = 20;

export interface PREdge {
  src: bigint;
  dst: bigint;
}

export function computePagerank(
  nodeIds: bigint[],
  edges: PREdge[],
): Map<bigint, number> {
  const N = nodeIds.length;
  if (N === 0) return new Map();

  const rank = new Map<bigint, number>();
  const newRank = new Map<bigint, number>();
  const outDegree = new Map<bigint, number>();
  const inEdges = new Map<bigint, bigint[]>();

  for (const id of nodeIds) {
    rank.set(id, 1 / N);
    outDegree.set(id, 0);
    inEdges.set(id, []);
  }

  for (const e of edges) {
    outDegree.set(e.src, (outDegree.get(e.src) ?? 0) + 1);
    const arr = inEdges.get(e.dst);
    if (arr) arr.push(e.src);
  }

  for (let i = 0; i < ITERATIONS; i++) {
    for (const id of nodeIds) {
      let sum = 0;
      for (const src of inEdges.get(id) ?? []) {
        const deg = outDegree.get(src) ?? 1;
        sum += (rank.get(src) ?? 0) / deg;
      }
      newRank.set(id, (1 - DAMPING) / N + DAMPING * sum);
    }
    for (const id of nodeIds) rank.set(id, newRank.get(id)!);
  }

  return rank;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/pagerank.test.ts
```
Expected: all pass.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
bun run typecheck && bunx @biomejs/biome check .
git add src/pagerank/ tests/unit/pagerank.test.ts
git commit -m "feat: iterative PageRank — damping 0.85, 20 iterations"
```

---

## Task 10: Infomap community detection (native CLI subprocess)

**Files:**
- Create: `src/community/infomap.ts`

No unit tests — subprocess integration. Tested in Task 12 (integration). Graceful fallback: if `infomap` is not in PATH, assign community 0 to all nodes.

- [ ] **Step 1: Create `src/community/infomap.ts`**

Infomap expects Pajek format (`.net`). Output is a `.tree` or `.clu` file. We generate a temp `.net` file, spawn `infomap`, parse output, and clean up.

```typescript
// src/community/infomap.ts
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface CommunityResult {
  communities: Map<bigint, number>;  // nodeId → community index
  method: "infomap" | "fallback";
}

function buildPajek(nodeIds: bigint[], edges: { src: bigint; dst: bigint }[]): string {
  const lines: string[] = [];
  const idxMap = new Map<bigint, number>();
  nodeIds.forEach((id, i) => idxMap.set(id, i + 1));

  lines.push(`*Vertices ${nodeIds.length}`);
  for (let i = 0; i < nodeIds.length; i++) lines.push(`${i + 1} "n${i + 1}"`);

  lines.push(`*Arcs`);
  for (const e of edges) {
    const s = idxMap.get(e.src);
    const d = idxMap.get(e.dst);
    if (s && d) lines.push(`${s} ${d} 1`);
  }

  return lines.join("\n");
}

function parseClu(content: string, nodeIds: bigint[]): Map<bigint, number> {
  const result = new Map<bigint, number>();
  for (const line of content.split("\n")) {
    if (line.startsWith("*") || line.trim() === "") continue;
    const parts = line.trim().split(/\s+/);
    const idx = parseInt(parts[0], 10) - 1;
    const community = parseInt(parts[1], 10);
    if (idx >= 0 && idx < nodeIds.length) {
      result.set(nodeIds[idx], community);
    }
  }
  return result;
}

export async function detectCommunities(
  nodeIds: bigint[],
  edges: { src: bigint; dst: bigint }[],
): Promise<CommunityResult> {
  if (nodeIds.length === 0) {
    return { communities: new Map(), method: "fallback" };
  }

  const workDir = join(tmpdir(), `tsgraph-infomap-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  const netFile = join(workDir, "graph.net");
  const outBase = join(workDir, "out");

  writeFileSync(netFile, buildPajek(nodeIds, edges));

  try {
    const proc = Bun.spawn(["infomap", netFile, workDir, "--clu", "--silent"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const cluFile = `${outBase}.clu`;
    if (!existsSync(cluFile)) {
      throw new Error("infomap produced no .clu output");
    }

    const communities = parseClu(readFileSync(cluFile, "utf8"), nodeIds);
    return { communities, method: "infomap" };
  } catch {
    // infomap not installed or failed — assign all nodes to community 0
    const fallback = new Map<bigint, number>();
    for (const id of nodeIds) fallback.set(id, 0);
    return { communities: fallback, method: "fallback" };
  } finally {
    try { rmSync(workDir, { recursive: true }); } catch { /* ok */ }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/community/infomap.ts
git commit -m "feat: infomap community detection via native CLI subprocess with fallback"
```

---

## Task 11: Build orchestrator

**Files:**
- Modify: `src/cli/build.ts` (replace stub)
- No new tests — covered by Task 12 integration test

The pipeline: discover files → chunk → [parse → dirty-check → analyze → write-to-sqlite] → compute PageRank from SQLite → detect communities → update SQLite.

- [ ] **Step 1: Replace `src/cli/build.ts` stub with the full orchestrator**

```typescript
// src/cli/build.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config/loader.ts";
import { extractFile } from "../parser/extract.ts";
import { resolveEdges } from "../analyzer/resolve.ts";
import { buildGraph } from "../graph/builder.ts";
import { computePagerank } from "../pagerank/compute.ts";
import { detectCommunities } from "../community/infomap.ts";
import { openDb } from "../storage/db.ts";
import {
  upsertFile,
  upsertNode,
  upsertEdge,
  updatePagerank,
  updateCommunity,
  getFileRecord,
  isDirty,
} from "../storage/writer.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function collectTsFiles(dir: string, include: string[], exclude: string[]): string[] {
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = posix(full.slice(dir.length + 1));
      if (entry.isDirectory()) {
        if (!exclude.some((pat) => matchGlob(rel, pat))) walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const included = include.some((pat) => matchGlob(rel, pat));
        const excluded = exclude.some((pat) => matchGlob(rel, pat));
        if (included && !excluded) results.push(posix(full));
      }
    }
  }
  walk(dir);
  return results;
}

function matchGlob(str: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  );
  return re.test(str);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function run(args: string[]): Promise<void> {
  const projectDir = resolve(args[0] ?? ".");
  const dbPath = join(projectDir, ".tsgraph.db");
  const cfg = loadConfig(projectDir);
  const db = openDb(dbPath);

  const allFiles = collectTsFiles(projectDir, cfg.include, cfg.exclude);
  if (allFiles.length === 0) {
    console.error(`No TypeScript files found in ${projectDir}`);
    process.exit(1);
  }

  console.log(`tsgraph build: ${allFiles.length} files in ${projectDir}`);
  console.log(`Chunk size: ${cfg.chunkSize}`);

  const allParsed: Awaited<ReturnType<typeof extractFile>>[] = [];
  const fileIds = new Map<string, bigint>();

  // Phase 1: chunked parse + write
  for (const fileChunk of chunk(allFiles, cfg.chunkSize)) {
    const parsed = await Promise.all(
      fileChunk.map(async (absPath) => {
        const source = readFileSync(absPath, "utf8");
        return extractFile(absPath, source, projectDir);
      }),
    );

    db.transaction(() => {
      for (const file of parsed) {
        const stored = getFileRecord(db, file.path);
        if (stored && !isDirty(stored, file)) {
          fileIds.set(file.path, stored.id);
          continue;
        }
        const fileId = upsertFile(db, {
          path: file.path,
          contentHash: file.contentHash,
          shapeHash: file.shapeHash,
          analyzedAt: Date.now(),
        });
        fileIds.set(file.path, fileId);
      }
    });

    allParsed.push(...parsed);
    process.stdout.write(`  Parsed ${Math.min(allParsed.length, allFiles.length)}/${allFiles.length}\r`);
  }

  console.log("\n  Resolving edges with TypeScript compiler...");

  // Phase 2: resolve edges (ts.createProgram) — after all parsing done
  const resolvedEdges = await resolveEdges(allParsed, projectDir);

  // Phase 3: build graph and write nodes + edges
  const { nodes, edges } = buildGraph(allParsed, resolvedEdges, fileIds);

  const nodeIds = new Map<string, bigint>();
  db.transaction(() => {
    for (const node of nodes) {
      const nid = upsertNode(db, {
        symbolId: node.symbolId,
        name: node.name,
        kind: node.kind,
        fileId: node.fileId,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
        signature: node.signature,
        isEntry: node.isEntry,
      });
      nodeIds.set(node.symbolId, nid);
    }
    for (const edge of edges) {
      const srcId = nodeIds.get(edge.srcSymbolId);
      const dstId = nodeIds.get(edge.dstSymbolId);
      if (srcId && dstId) {
        upsertEdge(db, { srcId, dstId, kind: edge.kind, key: edge.key });
      }
    }
  });

  console.log(`  ${nodes.length} nodes, ${edges.length} edges written`);

  // Phase 4: PageRank (from SQLite edge data, after TS Program is GC'd)
  console.log("  Computing PageRank...");
  const allNodeIds = [...nodeIds.values()];
  const dbEdges = db.all<{ src: number; dst: number }>("SELECT src, dst FROM edges").map(
    (e) => ({ src: BigInt(e.src), dst: BigInt(e.dst) }),
  );
  const ranks = computePagerank(allNodeIds, dbEdges);
  db.transaction(() => {
    for (const [id, rank] of ranks) updatePagerank(db, id, rank);
  });

  // Phase 5: Community detection (infomap, after PageRank)
  console.log("  Detecting communities...");
  const { communities, method } = await detectCommunities(allNodeIds, dbEdges);
  db.transaction(() => {
    for (const [id, community] of communities) updateCommunity(db, id, community);
  });
  if (method === "fallback") {
    console.log("  (infomap not found — all nodes assigned community 0)");
  }

  db.close();
  console.log(`Done. Graph written to ${dbPath}`);
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
bun run typecheck && bunx @biomejs/biome check .
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/build.ts
git commit -m "feat: build command orchestrator — chunked pipeline, pagerank, infomap"
```

---

## Task 12: End-to-end integration test

**Files:**
- Create: `fixtures/simple-ts/src/index.ts`
- Create: `fixtures/simple-ts/src/utils.ts`
- Create: `fixtures/simple-ts/tsconfig.json`
- Create: `tests/integration/build.test.ts`

- [ ] **Step 1: Create fixture TypeScript project**

```typescript
// fixtures/simple-ts/src/utils.ts
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
```

```typescript
// fixtures/simple-ts/src/index.ts
import { add, multiply } from "./utils.ts";

export function compute(x: number, y: number): number {
  return add(x, multiply(x, y));
}
```

```json
// fixtures/simple-ts/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write integration test**

```typescript
// tests/integration/build.test.ts
import { describe, expect, test, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "../../src/cli/build.ts";
import { openDb } from "../../src/storage/db.ts";

const FIXTURE = resolve(import.meta.dir, "../../fixtures/simple-ts");
const DB_PATH = join(FIXTURE, ".tsgraph.db");

function cleanup() {
  for (const s of ["", "-wal", "-shm"]) {
    try { unlinkSync(DB_PATH + s); } catch { /* ok */ }
  }
}

describe("build command integration", () => {
  afterEach(cleanup);

  test("creates .tsgraph.db in the project directory", async () => {
    await run([FIXTURE]);
    expect(existsSync(DB_PATH)).toBe(true);
  });

  test("writes nodes for exported symbols", async () => {
    await run([FIXTURE]);
    const db = openDb(DB_PATH);
    const nodes = db.all<{ name: string; is_entry: number }>(
      "SELECT name, is_entry FROM nodes WHERE is_entry = 1",
    );
    const names = nodes.map((n) => n.name);
    expect(names).toContain("add");
    expect(names).toContain("multiply");
    expect(names).toContain("compute");
    db.close();
  });

  test("writes files table with POSIX paths", async () => {
    await run([FIXTURE]);
    const db = openDb(DB_PATH);
    const files = db.all<{ path: string }>("SELECT path FROM files");
    for (const f of files) expect(f.path).not.toContain("\\");
    db.close();
  });

  test("all nodes have a pagerank > 0", async () => {
    await run([FIXTURE]);
    const db = openDb(DB_PATH);
    const nodes = db.all<{ pagerank: number }>("SELECT pagerank FROM nodes WHERE pagerank IS NOT NULL");
    for (const n of nodes) expect(n.pagerank).toBeGreaterThan(0);
    db.close();
  });

  test("second run is idempotent (no duplicate nodes)", async () => {
    await run([FIXTURE]);
    await run([FIXTURE]);
    const db = openDb(DB_PATH);
    const count = db.get<{ n: number }>("SELECT COUNT(*) as n FROM nodes")!;
    const distinct = db.get<{ n: number }>("SELECT COUNT(DISTINCT symbol_id) as n FROM nodes")!;
    expect(count.n).toBe(distinct.n);
    db.close();
  });
});
```

- [ ] **Step 3: Run integration test**

```bash
bun test tests/integration/build.test.ts
```
Expected: all pass. The test calls `run()` which triggers the full pipeline against the fixture.

- [ ] **Step 4: Run the full suite**

```bash
bun test
```
Expected: all 19 existing tests + new tests pass, 0 fail.

- [ ] **Step 5: Final verification gate**

```bash
bun run typecheck && bun test && bunx @biomejs/biome check .
```
Expected: clean across all three.

- [ ] **Step 6: Commit**

```bash
git add fixtures/ tests/integration/build.test.ts
git commit -m "test: e2e integration test for build command against fixture TS project"
```

---

## Self-Review

**Spec coverage:**
- ✅ Command isolation via dynamic import (Task 1)
- ✅ Config loader with chunk_size (Task 2)
- ✅ Chunked parse pipeline (Task 11)
- ✅ Dirty detection (Task 6)
- ✅ ts.createProgram edge resolution with createRequire (Task 7)
- ✅ PageRank after TS Program GC'd (Task 11 — sequential phases)
- ✅ Infomap subprocess with fallback (Task 10)
- ✅ POSIX-normalized paths (Tasks 4, 11)
- ✅ BigInt at SQLite boundary (Task 3)
- ✅ WAL + busy_timeout (existing openDb, unchanged)
- ✅ tsconfig plugins disabled (Task 7, `plugins: []`)

**Type consistency:**
- `upsertNode` takes `NodeRecord` with `fileId: bigint` — matches `GraphNode.fileId: bigint` used in Task 11. ✅
- `computePagerank` takes `PREdge[]` with `bigint` fields — matches the conversion in Task 11. ✅
- `detectCommunities` takes `bigint[]` — matches `nodeIds.values()` in Task 11. ✅

**No placeholders:** All steps contain code and expected output.
