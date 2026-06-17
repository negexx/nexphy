# tsgraph

A CLI tool that builds a queryable, directed knowledge graph of a TypeScript codebase. Users are TypeScript developers on Claude Code, Codex, or Cursor who want AI-quality context from their repo without burning tokens on file reads.

Not a linter, bundler, or language server — a graph builder and query tool.

## Stack

- **Runtime:** Bun (primary) / Node.js (fallback)
- **Language:** TypeScript 5.x
- **AST pre-pass:** web-tree-sitter (WASM) — NOT node-tree-sitter
- **Symbol resolution:** TypeScript Compiler API (`ts.createProgram`) via `createRequire(packageDir)`
- **Community detection:** native infomap CLI subprocess (`Bun.spawn`) — `@mapequation/infomap` npm is **browser-only** (Emscripten Worker + `URL.createObjectURL`), fails in both Bun dev and compiled mode (prototype validated 2026-06-17)
- **Storage:** bun:sqlite (primary) / better-sqlite3 (Node fallback) — abstraction layer
- **Config:** tsgraph.toml predicate language
- **Linting:** Biome

## Commands

```bash
# Development
bun run dev -- build ./path/to/repo   # run CLI in dev mode
bun test                               # run test suite
bun run typecheck                      # tsc --noEmit
bunx @biomejs/biome check .            # lint

# Build
bun build --compile src/cli.ts --outfile tsgraph   # compile binary
bun build src/cli.ts --outdir dist                  # Node fallback bundle

# Verify (all must pass before claiming done)
bun run typecheck && bun test && bunx @biomejs/biome check .
```

## Architecture

```
src/
├── cli.ts              # entry point, command dispatch
├── cli/                # subcommands: build, query, explain-edges
├── parser/             # web-tree-sitter AST pre-pass + dirty detection
├── analyzer/           # ts.createProgram symbol resolution
├── graph/              # node/edge types + builder
├── community/          # infomap integration + fallback subprocess
├── pagerank/           # reversed-edge PageRank, deterministic tie-break
├── storage/            # SQLite abstraction + schema + migrations
├── query/              # BFS subgraph + token-budget truncation
├── output/             # JSON serializer + legend
└── config/             # tsgraph.toml parser + predicate evaluator
prototypes/             # day-1 compatibility probes (infomap + web-tree-sitter)
tests/
├── unit/
└── integration/
```

## Conventions

- All paths POSIX-normalized before hashing or storing: `p.replace(/\\/g, '/')`
- Node IDs are stable integers; coerce to BigInt at the SQLite abstraction boundary
- Symbol resolution always via `createRequire(packageDir)`, never from project root
- tsconfig plugins DISABLED in createProgram options (security)
- Key extraction precedence: literal → enum constant → as-const member → `unresolved-key`
- `busy_timeout=5000` + `journal_mode=WAL` PRAGMAs on every DB open
- `PRAGMA user_version` checked on open; mismatch → nuke-rebuild, never silent migration
- Infomap phase-sequenced after TS Program is GC'd; never concurrent with createProgram
- PageRank tie-broken by node ID (not raw rank) for determinism
- Truncation is always BFS subgraph around query seed — never global top-N

## Day-1 prototypes (blocking)

Before any production code, validate in `prototypes/`:
1. `prototypes/infomap-bun.ts` — **DONE: FAIL** — `@mapequation/infomap` npm is browser-only (Emscripten Worker); both dev and compiled modes fail. Phase 2 uses native infomap CLI subprocess (`Bun.spawn`). See `prototypes/RESULTS.md §A`.
2. `prototypes/tree-sitter-bun.ts` — **DONE: PASS** (both modes) with sidecar WASM requirement. No `--asset` embed in Bun 1.3.14. Two sidecar files required: `tree-sitter.wasm` + `tree-sitter-typescript.wasm`. Use `dirname(process.execPath)` in compiled mode — NOT `import.meta.dir` (resolves to virtual path). Import as `{ Parser, Language }` named exports. See `prototypes/RESULTS.md §B`.

## Model dispatch

| Task | Model |
|---|---|
| Simple edits, renames, formatting | Haiku 4.5 |
| Feature work, debugging, reviews (DEFAULT) | Sonnet 4.6 |
| Architecture, security, schema design | Opus 4.8 |

Escalate when: repeated failures, hard graph algorithm reasoning, schema design, security review.

## Skills — when to invoke

Invoke the skill BEFORE acting. A ≥1% chance it applies means you MUST invoke it.

**Process skills — change HOW you work:**

| Situation | Skill |
|---|---|
| Bug / test failure / unexpected behavior | `superpowers:systematic-debugging` |
| New feature or creative work — before any code | `superpowers:brainstorming` |
| Multi-file task (feature, refactor, migration) | `superpowers:writing-plans` |
| Non-trivial logic (graph algorithms, hashing, SQL) | `superpowers:test-driven-development` |
| Plan with multiple independent tasks | `superpowers:subagent-driven-development` |
| 2+ tasks with no shared state | `superpowers:dispatching-parallel-agents` |
| Before claiming done / before commit or PR | `superpowers:verification-before-completion` |
| Feature branch implementation complete | `superpowers:finishing-a-development-branch` |

**Domain skills — load when context demands:**

| Situation | Skill |
|---|---|
| Writing against any library API (TypeScript compiler, bun:sqlite, infomap, tree-sitter) | `context7-mcp` |
| Hard architectural or tradeoff decision | `llm-council` |
| After adding a substantial new module (50+ lines) | `/graphify` |

## Don't

- Don't commit `.env*` files or secrets
- Don't use `node-tree-sitter` — it breaks in `bun build --compile`
- Don't resolve `typescript` from project root — use `createRequire(packageDir)`
- Don't use `@mapequation/infomap` npm package in Bun — it's browser-only; use native infomap CLI subprocess
- Don't use `.tsbuildinfo` for incremental builds
- Don't skip day-1 prototypes before production code in their domain
- Don't use global top-N truncation — BFS subgraph only
- Don't skip verification before claiming work done
- Don't start implementing before brainstorm + plan phases are complete
