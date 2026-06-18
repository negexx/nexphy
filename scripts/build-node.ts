import { cpSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

mkdirSync("dist/node", { recursive: true });

execSync(
  "bun build src/cli.ts --outdir dist/node --target node --splitting --external bun:sqlite",
  { stdio: "inherit" },
);

for (const wasm of [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
]) {
  const filename = wasm.split("/").at(-1)!;
  cpSync(`node_modules/${wasm}`, `dist/node/${filename}`);
  console.log(`Copied dist/node/${filename}`);
}
