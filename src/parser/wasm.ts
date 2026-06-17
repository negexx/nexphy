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
