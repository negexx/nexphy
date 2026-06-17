# Query Command Design

**Date:** 2026-06-18  
**Status:** Approved — pending implementation  
**Scope:** `tsgraph query <seed>` + `tsgraph explain-edges`

---

## Goal

Give an AI agent (or developer) a token-budgeted subgraph centered on a TypeScript symbol, returned as structured JSON. The caller reads one focused slice of the knowledge graph without touching source files.

---

## Seed Resolution

The seed argument accepts two forms:

- **Bare name** — `greet` — substring match on `nodes.name`, ranked by `pagerank` descending, top-1 wins. Zero matches → error with suggestions. Ambiguous qualified matches → user prompted to use qualified form.
- **Qualified ID** — `src/index.ts::greet` — exact match on `nodes.symbol_id`. Unambiguous; preferred in scripts and AI pipelines.

Resolution lives in `src/query/seed.ts`. It returns a single `NodeRow` or throws a descriptive error.

---

## DB Discovery

Walk up from `process.cwd()` looking for `.tsgraph.db`, identical to how `git` finds `.git`. Stop at the filesystem root. Fail with:

```
error: .tsgraph.db not found. Run `tsgraph build <dir>` first.
```

`--db <path>` overrides discovery entirely.

---

## BFS Traversal

**Direction:** bidirectional — follow edges in both directions (callers + callees).  
**Depth:** `--depth N`, default 3.  
**Priority:** pagerank descending — highest-ranked neighbors expand first when budget is tight.  
**Budget gate:** before adding a node, estimate its token cost (`JSON.stringify(node).length / 4`). If cumulative cost would exceed `--budget`, stop BFS and set `truncated: true`.

The seed node is always included regardless of budget.

BFS lives in `src/query/bfs.ts`. It takes a `nodeId`, `depth`, `budget`, and an open `SqliteDb`, returns `{ nodes: NodeRow[], edges: EdgeRow[], truncated: boolean }`.

---

## Output Format

JSON to stdout. Shape:

```json
{
  "seed": {
    "symbol_id": "src/index.ts::greet",
    "name": "greet",
    "kind": "function",
    "file": "src/index.ts",
    "line_start": 5,
    "pagerank": 0.42,
    "community": 1
  },
  "nodes": [
    {
      "symbol_id": "src/utils.ts::add",
      "name": "add",
      "kind": "function",
      "file": "src/utils.ts",
      "line_start": 1,
      "pagerank": 0.31,
      "community": 1
    }
  ],
  "edges": [
    {
      "src": "src/index.ts::greet",
      "dst": "src/utils.ts::add",
      "kind": "calls",
      "key": null
    }
  ],
  "truncated": false,
  "legend": {
    "node_kinds": {
      "function": "callable declaration",
      "class": "class declaration",
      "interface": "TypeScript interface",
      "type": "type alias",
      "enum": "enum declaration",
      "variable": "const/let/var declaration",
      "namespace": "module or namespace"
    },
    "edge_kinds": {
      "imports": "static import of a module member",
      "calls": "direct function or method invocation",
      "extends": "class or interface inheritance",
      "implements": "class implements interface",
      "references": "type or value reference not covered above"
    }
  }
}
```

The seed node is not repeated in `nodes`. Edges reference nodes by `symbol_id`, not by integer ID — so the output is self-contained without the database.

Serialization lives in `src/output/serialize.ts`. The legend is a static constant in `src/output/legend.ts`.

---

## CLI Flags

```
tsgraph query <seed> [options]

Arguments:
  seed             Symbol name or qualified ID (file::name)

Options:
  --depth N        BFS depth (default: 3)
  --budget N       Token budget (default: 8000)
  --db <path>      Path to .tsgraph.db (default: auto-discover)
```

---

## `explain-edges` Command

Static — no DB required. Prints the edge kind legend as JSON to stdout.

```bash
tsgraph explain-edges
```

Output is `{ "edge_kinds": { ... } }` — the same legend embedded in every `query` response, exposed standalone for documentation pipelines.

Lives in `src/cli/explain-edges.ts`, imports `LEGEND` from `src/output/legend.ts`.

---

## File Map

| File | Responsibility |
|---|---|
| `src/cli/query.ts` | Arg parsing, DB open, dispatch, print |
| `src/cli/explain-edges.ts` | Static legend printer |
| `src/query/seed.ts` | Seed resolution (name → NodeRow) |
| `src/query/bfs.ts` | Bidirectional BFS with pagerank priority + budget gate |
| `src/output/serialize.ts` | Assemble JSON response object |
| `src/output/legend.ts` | Static kind → description constants |

---

## Constraints

- `query` path must never load tree-sitter WASM or `ts.createProgram` (footprint Phase 1 invariant)
- All paths in output are POSIX-normalized (no backslashes)
- Integer node IDs never appear in output — `symbol_id` strings only
- Seed node always present in output even if budget is 0
- `--budget 0` returns seed node only with `truncated: true` (if neighbors exist)
- Error exit code 1; success exit code 0
