# tsgraph — TypeScript Code Graph CLI: Design Spec

> Authored: 2026-06-17  
> Status: Approved — ready for implementation planning  
> Verified: Claims fact-checked via Perplexity Pro (see §Verification notes)

---

## What is tsgraph

An open-source CLI tool that builds a queryable, directed knowledge graph of a TypeScript codebase. Primary users: TypeScript developers using Claude Code, Codex, or Cursor who want to reduce token usage during codebase navigation and get AI-quality context from their repo.

**Not** a linter, a bundler, or a language server. A graph builder and query tool.

---

## Goals (in priority order)

1. **Accuracy** — exact symbol resolution, not fuzzy approximation
2. **Depth** — framework-aware edges (Next.js RSC boundaries, Drizzle/Prisma table links, Inngest/tRPC/oRPC event chains)
3. **AI-optimised output** — compact JSON, query-scoped, token-budgeted for LLMs

---

## Architecture overview

```
tsgraph build
  ├── web-tree-sitter (WASM grammar)
  │     fast AST pre-pass + dirty-file detection
  ├── typescript (from user's per-package node_modules)
  │     ts.createProgram — in-process, batch, exact symbol resolution
  │     tsconfig plugins DISABLED (security)
  │     progress via CompilerHost.getSourceFile wrapper
  ├── @mapequation/infomap
  │     community detection on directed graph (map equation)
  │     runs its own internal Worker — do NOT wrap in an outer Worker
  │     prototype Bun Worker compatibility day 1; fallback: spawn infomap CLI subprocess
  │     seed pinned + --num-trials 1 for determinism
  │     phase-sequenced AFTER ts.createProgram is GC'd (memory)
  ├── PageRank (reversed edges, personalised from entry points)
  │     tie-broken by node ID for stable output across runs
  ├── bun:sqlite / better-sqlite3 (abstraction layer)
  │     symbol-shape hash per file (not raw content hash)
  │     SCC-condensed reverse-dep invalidation + N-file cap
  │     busy_timeout PRAGMA (concurrent writers)
  │     PRAGMA user_version (schema migration: nuke-rebuild on mismatch)
  ├── tsgraph.toml
  │     predicate language: import-path globs + AST patterns + producer/consumer keying
  │     key extraction: literals → enum members → as const member access → unresolved-key
  │     tsgraph explain-edges --framework X for debuggability
  └── bun build --compile (primary) / node dist/cli.js (fallback)
        5 per-platform binaries via optionalDependencies model
        both distribution paths e2e-tested independently
```

---

## Component decisions

### Host language: TypeScript / Bun

TypeScript is the host language because the TypeScript Compiler API runs in Node.js regardless of host — every other language pays an IPC/serialization boundary to reach it. TypeScript eliminates that boundary entirely. Contributors are TypeScript developers; one-language codebase minimises friction.

Bun is the primary runtime for `bun build --compile` single-binary distribution. Node.js is the fallback (TS devs have it installed).

### AST pre-pass: web-tree-sitter (WASM), not node-tree-sitter

`node-tree-sitter` resolves grammar `.node` addons via `node-gyp-build`'s runtime filesystem scan — this breaks inside `bun build --compile` because the dynamic path is invisible to the bundler. `web-tree-sitter` uses WASM grammars (`Language.load(pathOrBytes)`) which load uniformly across both distribution paths.

### Symbol resolution: TypeScript Compiler API (classic)

`ts.createProgram` → `program.getTypeChecker()` gives exact go-to-definition quality edges in one batch pass, in-process, no round-trips. LSP/tsserver was rejected: it is a per-cursor interactive protocol, not a batch analysis API.

**tsgo status (June 2026):** TypeScript 6.0 shipped March 2026. TypeScript 7.0 Beta shipped April 2026 (not January — earlier claim was wrong). The Corsa/tsgo programmatic API is explicitly flagged by the TypeScript team as unstable for tooling authors for "several more months" as of the 7.0 Beta announcement. The classic `typescript` API is the only viable programmatic surface today. Neither is officially "stable" — both are used by the ecosystem anyway.

**Critical:** always resolve `typescript` from the user's per-package `node_modules` via `createRequire(packageDir)`, not from project root. pnpm with `shamefullyHoist=false` (default since v7) places TypeScript at `node_modules/.pnpm/typescript@x.y.z/node_modules/typescript` and it is not resolvable from the root unless the root `package.json` explicitly declares it. Monorepos with multiple TypeScript versions need per-package resolution to avoid silent wrong edges.

**Failure modes to handle:**
- `MODULE_NOT_FOUND` (Bun-only projects, `--production` installs): fail loudly with "run: npm install typescript --save-dev"
- Project references (`references` in tsconfig): switch to `ts.createSolutionBuilder` path, not plain `createProgram`
- Unresolved module diagnostics: report `resolution_coverage` metric so consumers know graph quality

### Community detection: @mapequation/infomap

Infomap uses the map equation (minimum description length of directed random walks). It is better suited than Leiden/Louvain for directed call graphs because it respects flow direction; Leiden/Louvain optimise modularity which has directed variants but was designed for undirected graphs.

**Critical:** `@mapequation/infomap` is compiled as a web worker by the Infomap authors — it internally spawns its own Worker. Do not wrap it in an outer Worker. It expects browser-style `URL.createObjectURL(Blob)` for its inner worker bootstrap, which Bun may not support identically.

**Day-1 prototype requirement:** verify that `@mapequation/infomap` instantiates and runs correctly inside an actual `bun build --compile` binary on macOS + Linux + Windows. If it fails, fall back to spawning the **Infomap native CLI binary** as a subprocess (deterministic, memory-controllable, no WASM boundary).

**Determinism:** pin random seed + pass `--num-trials 1` to force single-threaded execution. FP tie-breaking in PageRank must sort by node ID, not raw rank value.

**Memory:** Infomap's WASM heap uses `ALLOW_MEMORY_GROWTH=1` — you cannot cap it externally. Mitigate by: (a) phase-sequencing after `ts.createProgram` is GC'd, (b) running Infomap only on the PageRank-top-N subgraph when graph exceeds ~50k nodes.

### Storage: SQLite with abstraction layer

Storage is `bun:sqlite` (primary, 3–6× faster than better-sqlite3, no native addon — survives `bun build --compile`) with `better-sqlite3` / `node:sqlite` (Node 22+) as fallback. Abstracted behind an interface (`open`, `prepare`, `run`, `all`) to swap implementations transparently.

**Integer type divergence:** `bun:sqlite` and `better-sqlite3` return different JS types for INTEGER columns in some cases. All comparisons on node IDs must use `BigInt` or enforce consistent typing at the abstraction boundary.

**Required PRAGMAs on open:**

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA user_version;
```

### Incremental updates: SQLite content cache + SCC-condensed invalidation

`createIncrementalProgram` and `.tsbuildinfo` are NOT used — they accelerate type-check emit, not graph construction, and sharing the user's `.tsbuildinfo` causes silent cache poisoning across TS versions.

**Correct approach:**
1. Hash all files (tree-sitter pre-pass, cheap)
2. Compute dirty set: files whose **symbol-shape hash** changed (not raw content hash)
3. Compute invalidation set: dirty files + **SCC-condensed transitive reverse-import closure** (Tarjan SCC to handle circular imports correctly)
4. Cap invalidation at N files; fall back to full rebuild past cap
5. Re-run `ts.createProgram` only over the invalidation set

**Symbol-shape hash:** hash of the emitted `.d.ts` declaration shape. Derive by running `ts.transpileModule` with `declaration: true` and hashing the output.

### Entry-point detection

1. `package.json` `bin`, `main`, `exports`, `module` fields → confidence 1.0
2. Zero-indegree nodes after barrel-file re-export chasing, excluding test files and ambient `.d.ts` → confidence 0.6
3. Framework convention globs (`app/**/page.tsx`, `app/**/route.ts`, `pages/api/**`) → confidence 0.4
4. Nodes tagged `entrypoint=true` by a `tsgraph.toml` producer rule → confidence 1.0

PageRank runs on **reversed edges**. Teleport mass allocated proportionally to confidence weights.

### tsgraph.toml predicate language

```toml
[[rule]]
name        = "rule-name"
match       = "<predicate expression>"
role        = "producer|consumer|definition|reference|tag"
key         = "<key extraction expression>"
edge        = "edge-kind-name"
entrypoint  = true
tag         = "tag-name"
```

Key extraction precedence:
1. String/number literal → `node.text`
2. Enum member → `checker.getConstantValue()`
3. `as const` member → walk symbol → declaration → initializer
4. Template literals / computed → `unresolved-key` bucket

Built-in examples:

```toml
[[rule]]
name  = "nextjs-client-boundary"
match = "file.directive == 'use client'"
tag   = "client-component"

[[rule]]
name  = "inngest-producer"
match = "call.callee == 'inngest.send'"
role  = "producer"
key   = "call.arg[0].prop('name').literal"
edge  = "inngest-event"

[[rule]]
name  = "inngest-consumer"
match = "call.callee == 'inngest.createFunction'"
role  = "consumer"
key   = "call.arg[1].prop('event').literal"
edge  = "inngest-event"
entrypoint = true

[[rule]]
name  = "drizzle-table-def"
match = "call.callee == 'pgTable'"
role  = "definition"
key   = "call.arg[0].literal"
edge  = "db-table"

[[rule]]
name  = "drizzle-table-query"
match = "member.object.type extends 'PgTableWithColumns'"
role  = "reference"
key   = "member.object.symbol"
edge  = "db-query"
```

---

## SQLite schema

```sql
PRAGMA user_version = 1;

CREATE TABLE files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  shape_hash   TEXT NOT NULL,
  analyzed_at  INTEGER NOT NULL
);

CREATE TABLE nodes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_id TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  file_id   INTEGER REFERENCES files(id),
  line_start INTEGER,
  line_end   INTEGER,
  signature  TEXT,
  pagerank   REAL,
  community  INTEGER,
  is_entry   INTEGER DEFAULT 0
);

CREATE TABLE edges (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  src     INTEGER NOT NULL REFERENCES nodes(id),
  dst     INTEGER NOT NULL REFERENCES nodes(id),
  kind    TEXT NOT NULL,
  key     TEXT,
  UNIQUE(src, dst, kind)
);

CREATE TABLE tags (
  node_id INTEGER REFERENCES nodes(id),
  tag     TEXT NOT NULL,
  PRIMARY KEY (node_id, tag)
);

CREATE INDEX idx_edges_src ON edges(src);
CREATE INDEX idx_edges_dst ON edges(dst);
CREATE INDEX idx_nodes_file ON nodes(file_id);
```

---

## JSON output schema

```jsonc
{
  "schema": 1,
  "query": { "seed": "src/lib/alloggiati/formatter.ts::formatSchedina", "depth": 2 },
  "truncated": false,
  "legend": {
    "nodeKinds": ["function","class","method","type","const","file"],
    "edgeKinds": ["imports","calls","extends","implements","produces","consumes","db-query","db-table","inngest-event","rpc-procedure"]
  },
  "nodes": [
    {
      "id": 1042,
      "name": "formatSchedina",
      "kind": "function",
      "file": "src/lib/alloggiati/formatter.ts",
      "loc": [12, 48],
      "signature": "(data: AlloggiatiPayload) => SchedineXML",
      "pagerank": 0.031,
      "community": 4,
      "isEntry": false,
      "truncated": false,
      "truncatedEdgeCount": 0
    }
  ],
  "edges": [
    { "id": 8801, "src": 1042, "dst": 1199, "kind": "calls" },
    { "id": 8802, "src": 1042, "dst": 1300, "kind": "imports" }
  ]
}
```

Truncation: BFS/personalised-PageRank subgraph around query seed until token budget exceeded. Never global top-N.

---

## Distribution

```
tsgraph                  (main package)
@tsgraph/darwin-arm64    (optionalDependency)
@tsgraph/darwin-x64      (optionalDependency)
@tsgraph/linux-x64-gnu   (optionalDependency)
@tsgraph/linux-x64-musl  (optionalDependency)
@tsgraph/linux-arm64     (optionalDependency)
@tsgraph/win-x64         (optionalDependency)
```

~50–100MB per binary. Both `bun --compile` and `node dist/cli.js` paths e2e-tested on CI independently.

---

## Known risks

| Risk | Mitigation |
|---|---|
| `@mapequation/infomap` Worker bootstrap fails under `bun --compile` | Prototype day 1; fallback to native CLI subprocess |
| web-tree-sitter WASM grammar in compiled binary | Test `bun --compile` binary explicitly |
| Silent wrong edges in multi-TS-version monorepo | Per-package `createRequire`; warn on multiple versions |
| `typescript` not installed | Clear actionable error message |
| Reverse-dep invalidation = whole repo | Symbol-shape hash + N-file cap + SCC condensation |
| Infomap WASM memory unbounded | Phase-sequence after TS Program GC'd; prune above 50k nodes |
| Cold start 30–90s silent hang | Progress via CompilerHost wrapper + Infomap onProgress |
| Concurrent processes → `SQLITE_BUSY` | `busy_timeout=5000` PRAGMA |
| Windows path separators break IDs | POSIX-normalize all paths before hashing |
| Schema migration | `PRAGMA user_version`; nuke-rebuild on mismatch |

---

## Verification notes

Fact-checked in two rounds: Perplexity Pro 2026-06-17 (original) and Perplexity Pro 2026-06-17 (Opus 4.8 audit claims).

| Claim | Status | Notes |
|---|---|---|
| `@mapequation/infomap` spawns own Worker | Partially true | Confirmed Emscripten web-worker build; `URL.createObjectURL` use is plausible but unconfirmed from source |
| node-tree-sitter breaks in `bun --compile` | Partially true | Inferred from Bun docs; WASM variant "considerably slower" per official tree-sitter docs but "small in practice" per Pulsar |
| `node:sqlite` not in Bun | **Verified** | |
| TS 7.0 shipped Jan 2026 | **FALSE** | TS 6.0 shipped March 2026; TS 7.0 Beta shipped April 2026. Spec corrected. |
| Corsa programmatic API unstable for tooling authors | **Verified** | Official 7.0 Beta announcement explicitly states this |
| Infomap better suited for directed graphs | Partially true — Leiden has directed variants | |
| `getConstantValue()` fails for `as const` | Partially true | |
| pnpm strict mode blocks root resolution | Partially true | Holds when TS is only a transitive dep; direct dep is still resolvable from root |
| `ts.createProgram` no progress callback | **Verified** | |
| `PRAGMA user_version` for schema versioning | **Verified** | |
| optionalDependencies model + 50–100MB binaries | **Verified** | |
| oxc significantly faster than tree-sitter | **Unverified** | oxc is 3× faster than SWC; no published tree-sitter vs oxc benchmark exists |
| SQLite INTEGER PRIMARY KEY IDs renumber on rebuild | Partially true — wrong word | IDs are *reused* (not renumbered) when rows are deleted and new ones inserted. Fixed: all PKs now use `AUTOINCREMENT` |
| bun:sqlite vs better-sqlite3 BigInt divergence | Partially true | Difference is configuration-driven (`safeIntegers`), not inherent; align both to same setting |
| PPR beats BFS for AI context selection | Partially true | Supported by GraphRAG/Mixture-of-PageRanks research; no direct code-graph head-to-head published |
| Next.js server actions invisible to import graphs | Partially true — core claim correct | RPC boundary is real; no external static analysis tool confirmed as detecting these edges |

---

## Not in scope for v1

- Languages other than TypeScript/TSX
- `.vue`, `.svelte`, `.astro` SFC support
- Plugin escape hatch in tsgraph.toml
- LSP server mode
- GitHub Actions integration
- Web UI / graph visualisation
- tsgo/Corsa API
