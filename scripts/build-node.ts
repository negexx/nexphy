import { execSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/node", { recursive: true });

execSync(
  "bun build src/cli.ts --outdir dist/node --target node --splitting --external bun:sqlite --external better-sqlite3",
  { stdio: "inherit" },
);

for (const wasm of [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
]) {
  const filename = wasm.split("/").pop() ?? wasm;
  cpSync(`node_modules/${wasm}`, `dist/node/${filename}`);
  console.log(`Copied dist/node/${filename}`);
}
