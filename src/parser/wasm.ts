import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Three-way sentinel:
//   Node.js:          typeof Bun === "undefined" → not compiled, use import.meta.url
//   Bun dev mode:     Bun runtime + execPath ends with "bun"/"bun.exe" → not compiled, use import.meta.url
//   Bun compiled:     Bun runtime + execPath does NOT end with "bun"/"bun.exe" → use dirname(process.execPath)
const isBunRuntime = typeof Bun !== "undefined";
const isCompiled =
  isBunRuntime &&
  !process.execPath.endsWith("bun") &&
  !process.execPath.endsWith("bun.exe");

function getModuleDir(): string {
  if (isCompiled) {
    // Compiled binary: WASM sidecars must be placed next to the executable.
    return dirname(process.execPath);
  }
  // Node.js or Bun dev mode: resolve from this file's location.
  return dirname(fileURLToPath(import.meta.url));
}

function candidates(filename: string): string[] {
  const moduleDir = getModuleDir();
  if (isCompiled) {
    return [join(moduleDir, filename)];
  }
  return [
    join(moduleDir, filename),
    join(moduleDir, "../../node_modules/web-tree-sitter", filename),
    join(moduleDir, "../../node_modules/tree-sitter-typescript", filename),
    join(process.cwd(), "node_modules/web-tree-sitter", filename),
    join(process.cwd(), "node_modules/tree-sitter-typescript", filename),
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
