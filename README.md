<h1 align="center">nexphy</h1>

<p align="center">
  <strong>TypeScript knows what your code means. Now so does your AI.</strong>
</p>

<p align="center">
  <a href="https://github.com/negexx/nexphy/actions/workflows/ci.yml"><img src="https://github.com/negexx/nexphy/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="MIT Licence"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/storage-SQLite-003b57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#benchmark">Benchmark</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#configuration">Configuration</a>
</p>

---

Most code-graph tools parse syntax. **nexphy parses semantics.**

It uses the TypeScript Compiler API — the same engine that powers VS Code IntelliSense — to build a directed graph of every symbol, import, call, and type relationship in your codebase. When your AI needs context about a symbol, nexphy returns a token-budget-aware BFS subgraph ranked by PageRank importance instead of a pile of raw files.

```
Without nexphy             With nexphy
─────────────────          ─────────────────────────────
AI reads 31 files          AI reads 1 query response
= 17,113 tokens            = ~4,684 tokens  →  3.7x reduction
```

---

## Quick Start

```bash
# 1. Index your TypeScript project (one-time, ~2s for 30 files)
bun run dev -- build ./my-project

# 2. Query any symbol by name or qualified ID
bun run dev -- query UserService
bun run dev -- query "src/auth/service.ts#authenticate"

# 3. Pipe directly into your AI as context
bun run dev -- query UserService --depth 3 | pbcopy
```

Incremental rebuilds only re-parse files that changed — identical content hash means zero work.

---

## How It Works

```
TypeScript files
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1 — Parse (web-tree-sitter WASM)                 │
│  Extracts symbols, signatures, line ranges, exports      │
│  Dirty detection via SHA-1 content + shape hash         │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 2 — Resolve (TypeScript Compiler API)            │
│  ts.createProgram → real type resolution                │
│  Edges: imports · calls · extends · implements          │
│  Handles re-exports, type aliases, overloads            │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 3 — Store (SQLite, WAL mode)                     │
│  Nodes and edges written atomically per build           │
│  Stale edges pruned before each run                     │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 4 — Rank (reversed-edge PageRank)                │
│  Heavily-depended-upon symbols score highest            │
│  Dangling-node correction · convergence check           │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 5 — Cluster (infomap community detection)        │
│  Groups related modules; falls back gracefully          │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
                      .nexphy.db
                      (SQLite graph)
                            │
                   nexphy query <seed>
                            │
                            ▼
              BFS subgraph · token budget · JSON
```

### Why the TypeScript Compiler API matters

Most graph tools use [tree-sitter](https://tree-sitter.github.io/tree-sitter/) — a fast, pattern-matching AST parser. Tree-sitter is great for syntax. It cannot resolve types.

```typescript
// tree-sitter sees: re-export pattern
// nexphy sees: BaseService lives in services/base.ts,
//              AuthService extends it,
//              validate() is called by 5 upstream modules
export { AuthService } from "./auth/service.ts";
```

nexphy calls `ts.getTypeChecker()` after building the full program. It resolves type aliases through re-exports, follows generic instantiations, and picks the correct declaration among overloaded functions. The edges it produces are semantically correct, not pattern-matched.

### Token-budget BFS

When you run `nexphy query <seed>`, it does a BFS from that symbol outward, adding the highest-PageRank neighbors first and stopping exactly when the next node would exceed your token budget.

```
seed: UserService  (depth=3, budget=8000 tokens)

BFS frontier                   PageRank order
────────────────────────────   ─────────────────────────
hop 1: AuthMiddleware  ★★★★★   → added first
        Logger         ★★☆☆☆   → added
hop 2: TokenStore      ★★★★☆   → added
        EmailService   ★☆☆☆☆   → budget hit → STOP
                                   truncated: true
```

You always get the most architecturally significant context that fits, not a random slice.

---

## Benchmark

Measured on the nexphy codebase itself (31 TypeScript source files).  
Methodology: compare `nexphy query <seed>` token count vs reading every `.ts` file.  
Token estimate: 1 token ≈ 4 characters.

```
Symbol                 Nexphy    Naive  Reduction  Saved
────────────────────────────────────────────────────────
computePagerank         5,212   17,113      3.3x   69.5%
resolveEdges            5,212   17,113      3.3x   69.5%
extractFile             5,212   17,113      3.3x   69.5%
bfsSubgraph             2,723   17,113      6.3x   84.1%
resolveSeed             2,723   17,113      6.3x   84.1%
detectCommunities       5,212   17,113      3.3x   69.5%
openDb                  7,129   17,113      2.4x   58.3%
loadConfig              5,212   17,113      3.3x   69.5%
upsertNode              5,212   17,113      3.3x   69.5%
buildPajek              2,994   17,113      5.7x   82.5%
────────────────────────────────────────────────────────
AVERAGE                 4,684   17,113      3.7x   72.6%

Build time : 2,177ms (one-time)
Query latency : ~157ms per query
```

**The gains compound on larger projects.** nexphy caps output at your `--budget` (default 8,000 tokens). The naive baseline grows with every source file you add. A 200-file project with a ~110,000-token naive baseline would produce roughly 14–25x reductions on the same queries.

Run it on your own project:

```bash
bun run benchmark --project /path/to/your/ts-project
# optional: --depth 3 --budget 8000
```

---

## Query output

```json
{
  "seed": {
    "symbol_id": "src/auth/service.ts#AuthService",
    "name": "AuthService",
    "kind": "class",
    "file": "src/auth/service.ts",
    "line_start": 12,
    "pagerank": 0.0842,
    "community": 1
  },
  "nodes": [
    {
      "symbol_id": "src/storage/token-store.ts#TokenStore",
      "name": "TokenStore",
      "kind": "class",
      "file": "src/storage/token-store.ts",
      "line_start": 5,
      "pagerank": 0.0631,
      "community": 1
    }
  ],
  "edges": [
    {
      "src": "src/auth/service.ts#AuthService",
      "dst": "src/storage/token-store.ts#TokenStore",
      "kind": "imports",
      "key": null
    }
  ],
  "truncated": false,
  "legend": {
    "edge_kinds": {
      "imports":    "static import of a module member",
      "calls":      "direct function or method invocation",
      "extends":    "class or interface inheritance",
      "implements": "class implements interface",
      "uses-type":  "type-only import (no runtime dependency)",
      "re-exports": "re-export from another module"
    }
  }
}
```

Pipe it into Claude, GPT-4o, or any tool that accepts JSON context. `truncated: true` means the token budget was hit — increase `--budget` or reduce `--depth` to control the trade-off.

---

## Commands

### `nexphy build <dir>`

Index a TypeScript project. Creates `.nexphy.db` in the project root.

```bash
bun run dev -- build ./my-project

# Options (via nexphy.toml — see Configuration)
# Incremental: only changed files are re-parsed
```

### `nexphy query <seed>`

Return a BFS subgraph around a symbol as JSON.

```bash
# Bare name — resolves by highest-PageRank match
bun run dev -- query UserService

# Qualified ID — exact match
bun run dev -- query "src/auth/service.ts#AuthService"

# Options
--depth  N    BFS hops from the seed node  (default: 3)
--budget N    Max output tokens             (default: 8000)
--db    path  Override .nexphy.db location
```

### `nexphy explain-edges`

Print the full edge-kind legend as JSON.

```bash
bun run dev -- explain-edges
```

---

## Installation

### Dev mode (Bun required)

```bash
git clone https://github.com/negexx/nexphy
cd nexphy
bun install

bun run dev -- build ./my-project
bun run dev -- query MySymbol
```

### Compiled binary

Produces a single portable executable. Two WASM sidecar files are required next to the binary.

```bash
# Build
bun build --compile src/cli.ts --outfile nexphy

# Copy WASM sidecars into the same directory
cp node_modules/web-tree-sitter/web-tree-sitter.wasm .
cp node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm .

# Use
./nexphy build ./my-project
./nexphy query MySymbol --depth 2
```

No Python, no pip, no virtual environments.

---

## Configuration

Create `nexphy.toml` in your project root to override defaults.

```toml
[build]
chunk_size = 100        # files parsed per batch (default: 200)

[include]
patterns = ["src/**/*.ts"]   # default: ["**/*.ts"]

[exclude]
patterns = [
  "node_modules/**",
  "dist/**",
  "**/*.test.ts",
  "**/*.spec.ts",
]
```

All patterns are glob strings relative to the project root. When `nexphy.toml` is absent, the defaults above apply.

---

## How incremental builds work

nexphy stores a SHA-1 content hash and a shape hash (sorted symbol IDs) for every file.

```
On each build:
  for each .ts file:
    if content_hash unchanged → skip
    else → re-parse, delete old nodes, insert new nodes

  delete edges for the whole project
  re-resolve all edges from the current file set
  recompute PageRank
  recompute communities
```

Only the dirty files go through the tree-sitter + TypeScript Compiler API pipeline. On a 500-file project with 3 changed files, ~497 files are skipped.

---

## Edge types

| Kind | Meaning |
|---|---|
| `imports` | Static import of a module member |
| `calls` | Direct function or method invocation |
| `extends` | Class or interface inheritance |
| `implements` | Class implements interface |
| `uses-type` | Type-only import (`import type`) — no runtime dependency |
| `re-exports` | `export { X } from "..."` — re-export from another module |

---

## Stack

| Concern | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) (primary) / Node.js (fallback) |
| Language | TypeScript 5.x |
| AST pre-pass | [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web) (WASM) |
| Symbol resolution | TypeScript Compiler API (`ts.createProgram`) |
| Importance ranking | Reversed-edge PageRank with dangling-node correction |
| Community detection | [infomap](https://www.mapequation.org/infomap/) native CLI subprocess |
| Storage | bun:sqlite (Bun) / better-sqlite3 (Node.js) |
| Linting | [Biome](https://biomejs.dev) |

---

## Development

```bash
bun install          # install dependencies
bun test             # run test suite (73 tests)
bun run typecheck    # tsc --noEmit
bunx @biomejs/biome check .   # lint

bun run benchmark    # measure token reduction on this repo
```

All three checks must pass before any commit.

---

## Licence

MIT
