# Prototype Results

## A — @mapequation/infomap

| Mode     | Result       | Notes |
|----------|--------------|-------|
| dev      | FAIL         | `new Infomap()` succeeds; `.runAsync()` fails — Bun cannot parse the emscripten-generated WASM blob inside the Web Worker |
| compiled | FAIL (harder) | `new Infomap()` itself throws `Object is not a constructor` — ESM default export doesn't survive `bun build --compile` bundling |

### Root cause

`@mapequation/infomap` v1.9.0 is a **browser-only** package:

- `package.json` exports only `"browser": "index.js"` / `"main": "index.js"` (same file, no Node/Bun variant)
- `index.js` (webpack bundle) uses `URL.createObjectURL(new Blob([wasmWorkerCode], {type: "application/javascript"}))` then `new Worker(blobUrl)` to spin up an emscripten WASM module in a Web Worker
- The bundled WASM JS is emscripten output with syntax that Bun's parser rejects when evaluating inside a blob URL

### Dev mode error output (key lines)

```
=== Prototype A: @mapequation/infomap ===
Package version: 1.9.0
✓ new Infomap() succeeded
Attempting runAsync() …
✗ runAsync() failed: 10 | e=t[c|0];if(b>>>0>=f>>>0){break b}...
error: Invalid assignment target
    at blob:9565b678-4334-4165-be10-4b8a030c16ac:10:142209
  → Unexpected error — investigate further
FAIL
```

### Compiled binary error output (key lines)

```
=== Prototype A: @mapequation/infomap ===
Package version: unknown
✗ new Infomap() threw: Object is not a constructor (evaluating 'new import_infomap.default')
FAIL
```

### Decision

**Both modes FAIL — implement subprocess fallback before Phase 2.**

The `@mapequation/infomap` npm package cannot be used directly in a Bun CLI (dev or compiled).

Fallback plan for Phase 2:

1. **Primary**: invoke the native `infomap` binary as a subprocess (`Bun.spawn` / `child_process.spawn`)
   - The [infomap PyPI package](https://pypi.org/project/infomap/) ships native binaries for Linux/macOS/Windows
   - Alternatively build from source: https://github.com/mapequation/infomap (C++ with CMake)
   - Or use the [pre-built CLI releases](https://github.com/mapequation/infomap/releases) and bundle/require the binary
2. **Alternative**: use the Python `infomap` package via a thin Python script subprocess (simpler on systems with Python)
3. **Do NOT**: attempt to use `@mapequation/infomap` (npm) directly in Bun — it is hardcoded to browser Web Worker + WASM

Architecture impact: tsgraph Phase 2 must treat community detection as an **external process call** with defined stdin/stdout protocol (Pajek/edge-list in, `.tree`/`.clu` text out), not a library call.

---

## B — web-tree-sitter WASM

| Mode              | Result | Notes |
|-------------------|--------|-------|
| dev               | PASS   | `bun run prototypes/tree-sitter-bun.ts` — both engine WASM and grammar WASM loaded from `node_modules/` via `process.cwd()` |
| compiled (cwd)    | PASS   | `bun build --compile` + run from project dir — same `process.cwd()` path hits `node_modules/` |
| compiled (sidecar) | PASS  | Run binary from arbitrary dir with WASM files placed next to `.exe` — resolved via `dirname(process.execPath)` |

### Key findings

**Bun 1.3.14 has no `--asset` flag** for embedding WASM into compiled binaries. The `--help` output confirms no asset-embedding flag exists. WASM files cannot be bundled into the executable itself.

**Two-WASM requirement:**
- `tree-sitter.wasm` — the emscripten engine from `web-tree-sitter` (205 KB)
- `tree-sitter-typescript.wasm` — the TypeScript grammar from `tree-sitter-typescript` (1.4 MB)

**Path resolution in compiled binaries:**
- `import.meta.dir` is `B:\~BUN\root` (virtual, useless for file I/O)
- `process.cwd()` is the user's working directory (unreliable for distribution)
- `dirname(process.execPath)` is the directory containing the `.exe` (reliable — use this)

**API correction (vs. spec):**
- Import is `{ Parser, Language }` (named exports), NOT `import Parser from 'web-tree-sitter'` (default)
- `Language` is a top-level export, NOT `Parser.Language`
- `Parser.init({ wasmBinary: Buffer })` — pass engine WASM bytes directly to bypass emscripten's broken path resolution in compiled mode
- `Language.load(Uint8Array)` — pass grammar WASM bytes directly

### Dev mode output (key lines)

```
=== Prototype B: web-tree-sitter ===
web-tree-sitter version: 0.25.10
✓ Parser.init() succeeded (explicit wasmBinary from: .../node_modules/web-tree-sitter/tree-sitter.wasm )
✓ Grammar WASM located at: .../node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm
✓ Language.load(Buffer) succeeded
  Language name: (null — grammar omits metadata)
  ABI version: 14
✓ Parsed snippet, root node type: program
✓ Arrow function nodes found: 1
  Identifiers: greet, name, name, x
PASS
```

### Compiled (sidecar) output (key lines)

```
=== Prototype B: web-tree-sitter ===
process.execPath: C:\...\proto-ts.exe
process.cwd(): C:\Users\dagda\AppData\Local\Temp   ← different dir, no node_modules
import.meta.dir: B:\~BUN\root                      ← virtual, useless
✓ Parser.init() succeeded (explicit wasmBinary from: C:\...\tree-sitter.wasm )
✓ Grammar WASM located at: C:\...\tree-sitter-typescript.wasm
PASS
```

### Decision

**Both modes PASS — proceed to Phase 2 with sidecar WASM distribution.**

The `web-tree-sitter` + `tree-sitter-typescript` combo works in both Bun dev and compiled binary modes, **provided**:

1. WASM files are distributed as side-car files next to the binary
2. Path resolution uses `dirname(process.execPath)` as the primary candidate
3. Engine WASM is passed as `{ wasmBinary }` to `Parser.init()` — never rely on emscripten's default `locateFile` in a compiled binary
4. Grammar WASM is read with `readFileSync` and passed as `Uint8Array` to `Language.load()`

Phase 2 implementation plan for `src/parser/`:
- Export a `resolveWasmDir()` helper: `dirname(process.execPath)` first, then `process.cwd()/node_modules/...` fallback for dev
- The `bun build` step in CI must copy both WASM files into the `dist/` directory alongside `tsgraph.exe`
- Document the two-file sidecar requirement in the README install section
