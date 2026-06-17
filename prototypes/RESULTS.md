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
