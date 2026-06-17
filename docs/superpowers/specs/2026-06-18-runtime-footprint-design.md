# Runtime Footprint Optimizations

**Date:** 2026-06-18
**Status:** Approved — pending implementation
**Scope:** Binary size, cold-start latency, peak memory during build

---

## Goal

Both `query` and `build` must be lean across all repo sizes (< 500 files to 50 000+ files):

- `query` — called per-AI-request; cold-start latency is critical
- `build` — infrequent but heavy; peak memory must not grow with repo size

MCP server mode is explicitly out of scope: it consumes more tokens than direct CLI invocations.

---

## Chosen Approach: Option C (phased)

Implement in three phases, each independently shippable:

### Phase 1 — Command isolation via dynamic import (highest leverage)

Split every subcommand into its own module under `src/cli/`. The CLI entry point (`src/cli.ts`) does nothing but `parseArgs` and a single `await import('./cli/<command>.ts')`. 

Result: `tsgraph query` never loads tree-sitter WASM or `ts.createProgram`. Cold start = `parseArgs` + SQLite open + BFS only.

Constraint: no shared top-level imports across command subtrees. Any helper used by both `build` and `query` lives in `src/shared/` and is imported explicitly — never re-exported from a command module.

### Phase 2 — Streaming build pipeline with memory ceiling

Process files in fixed-size chunks (default: 200 files, configurable via `tsgraph.toml`). Per chunk:

1. Parse with tree-sitter → extract symbols
2. Resolve with `ts.createProgram` → emit edges
3. Write nodes + edges to SQLite
4. Discard AST and Program — allow GC before next chunk

Infomap and PageRank run after all chunks are complete and the last Program is GC'd (existing CLAUDE.md invariant preserved). Memory ceiling becomes `O(chunk_size)`, not `O(repo_size)`.

### Phase 3 — `--splitting` for the Node fallback bundle

Apply `bun build --splitting` to the Node distribution so each command ships as a separate entry-point chunk. Non-Bun users load only the chunk their command needs. The compiled binary already benefits from tree-shaking; splitting adds value on the Node path only.

Requires: CI must test compiled binary and Node split-bundle paths independently.

---

## Constraints

- Chunk size default (200 files) is a starting point; must be tunable via `tsgraph.toml`
- Dynamic `import()` adds ~1–5 ms per command dispatch — acceptable
- `build` and `query` share zero top-level initialization cost
- All existing CLAUDE.md invariants hold: Infomap after TS Program GC, WAL pragmas on every open, POSIX-normalized paths, BigInt at SQLite boundary

---

## What This Does Not Cover

- Watch mode (separate feature)
- Startup profiling tooling (measure after implementation)
- Node fallback splitting (Phase 3, deferred until Phases 1–2 are stable)
