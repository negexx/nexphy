# Release Pipeline Design

**Date:** 2026-06-18
**Status:** Approved — pending implementation
**Scope:** Node.js compatibility layer + compiled binary builds + GitHub Release + npm publish

---

## Goal

Make `nexphy` distributable to TypeScript developers who cannot or do not want to install Bun:

- **GitHub Releases** — pre-compiled binaries per platform, downloadable without any package manager
- **npm** — `npx nexphy` / `npm install -g nexphy` via the Node.js split bundle

---

## Package Identity

`package.json` changes:
- `name`: `tsgraph` → `nexphy`
- `bin`: `{ "nexphy": "./dist/node/cli.js" }` (npm path; compiled binary path is platform-specific)
- `files`: `["dist/node/**"]` (WASM files are included inside `dist/node/`; `dist/tsgraph` dev binary is excluded by default since it is not listed)
- `version`: stays `0.1.0`

---

## Distribution Shape

### GitHub Releases

Four zip archives, one per platform, each containing:
- The compiled binary (`nexphy` or `nexphy.exe`)
- `web-tree-sitter.wasm`
- `tree-sitter-typescript.wasm`

| Archive | Binary target |
|---|---|
| `nexphy-linux-x64.zip` | `bun-linux-x64-musl` |
| `nexphy-linux-arm64.zip` | `bun-linux-arm64-musl` |
| `nexphy-macos-arm64.zip` | `bun-darwin-arm64` |
| `nexphy-windows-x64.zip` | `bun-windows-x64` (produces `nexphy.exe`) |

All four built from a single Ubuntu runner via Bun cross-compilation.

### npm (`nexphy`)

Node.js split bundle built with `bun build --target node --splitting`. WASM files copied into `dist/node/` alongside the bundle chunks. `bin.nexphy` → `dist/node/cli.js`.

---

## Node.js Compatibility Layer

Three Bun-specific APIs replaced with portable equivalents:

### 1. Storage: `bun:sqlite` → `better-sqlite3`

Add `better-sqlite3` as a runtime dependency. Create `src/storage/node-sqlite.ts` implementing the existing `SqliteDb` / `SqliteStatement` interface using `better-sqlite3`.

Runtime detection in `src/storage/db.ts`:

```typescript
const impl = typeof Bun !== "undefined"
  ? await import("./bun-sqlite.ts")
  : await import("./node-sqlite.ts");
```

The `SqliteDb` interface is already defined in `src/storage/interface.ts` — no interface changes needed.

### 2. TOML: `Bun.TOML.parse` → `smol-toml`

Add `smol-toml` as a runtime dependency. In `src/config/loader.ts`:

```typescript
import { parse } from "smol-toml";
// replace: Bun.TOML.parse(raw) → parse(raw)
```

### 3. WASM loading: `import.meta.dir` → `dirname(fileURLToPath(import.meta.url))`

In `src/parser/init.ts`, replace the Bun-specific `import.meta.dir` with portable ESM:

```typescript
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function getDir(): string {
  // Compiled Bun binary: Bun.embeddedFiles is defined (even if empty)
  if (typeof Bun !== "undefined" && "embeddedFiles" in Bun) {
    return dirname(process.execPath);
  }
  return dirname(fileURLToPath(import.meta.url));
}
```

The compiled-mode check uses `"embeddedFiles" in Bun` — the canonical Bun compiled-mode sentinel. The `fileURLToPath(import.meta.url)` form works in both Bun dev mode and Node.js.

---

## Build Scripts

Added to `package.json`:

```json
"build:node":  "bun build src/cli.ts --outdir dist/node --target node --splitting && cp node_modules/web-tree-sitter/web-tree-sitter.wasm dist/node/ && cp node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm dist/node/",
"build:bins":  "bun run scripts/build-bins.ts",
"build:all":   "bun run build:node && bun run build:bins"
```

`scripts/build-bins.ts` loops over the 4 platform targets, runs `bun build --compile --target <t> --outfile dist/<name>`, then copies WASM sidecars next to each binary and zips the result into `dist/`.

The existing `"build"` script (produces `dist/tsgraph` for local dev and CI) is unchanged.

---

## Release Workflow

**File:** `.github/workflows/release.yml`
**Trigger:** `on: push: tags: ["v*.*.*"]`
**Runner:** `ubuntu-latest` (single runner, cross-compile all platforms)

Steps:
1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` (latest)
3. `bun install --frozen-lockfile`
4. `bun run build:all` — produces `dist/node/` + 4 zipped platform binaries in `dist/`
5. `gh release create ${{ github.ref_name }} --title "nexphy ${{ github.ref_name }}" --generate-notes` + upload 4 zip files
6. `npm publish --access public` using `NODE_AUTH_TOKEN` secret

**Required GitHub secrets:**
- `NODE_AUTH_TOKEN` — npm automation token (classic token with `publish` scope)

The existing `ci.yml` workflow is untouched — it continues to run on every push and PR.

---

## CI Update

The existing `binary` job in `ci.yml` continues to test `dist/tsgraph` (the dev-mode compile). No changes. The release workflow is purely additive.

---

## What This Does Not Cover

- Homebrew tap — future work
- Windows-native binary signing — future work
- Matrix builds for Node.js bundle (single OS is sufficient for a pure-JS bundle)
- Release notes automation beyond `--generate-notes`
