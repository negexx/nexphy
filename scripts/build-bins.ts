import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const WASM_FILES = [
  { src: "node_modules/web-tree-sitter/web-tree-sitter.wasm", name: "web-tree-sitter.wasm" },
  {
    src: "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm",
    name: "tree-sitter-typescript.wasm",
  },
];

const TARGETS = [
  { platform: "linux-x64", bunTarget: "bun-linux-x64-musl", binary: "nexphy" },
  { platform: "linux-arm64", bunTarget: "bun-linux-arm64-musl", binary: "nexphy" },
  { platform: "macos-arm64", bunTarget: "bun-darwin-arm64", binary: "nexphy" },
  { platform: "windows-x64", bunTarget: "bun-windows-x64", binary: "nexphy.exe" },
];

mkdirSync("dist", { recursive: true });

for (const { platform, bunTarget, binary } of TARGETS) {
  const stagingDir = join("dist", platform);
  if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true });
  mkdirSync(stagingDir);

  const binaryPath = join(stagingDir, binary);
  console.log(`\nBuilding ${platform}...`);
  execSync(`bun build --compile src/cli.ts --target ${bunTarget} --outfile ${binaryPath}`, {
    stdio: "inherit",
  });

  for (const { src, name } of WASM_FILES) {
    cpSync(src, join(stagingDir, name));
  }

  const zipPath = join("dist", `nexphy-${platform}.zip`);
  execSync(`zip -j ${zipPath} ${stagingDir}/${binary} ${stagingDir}/*.wasm`, {
    stdio: "inherit",
  });
  console.log(`Created ${zipPath}`);
}

console.log("\nAll platform binaries built successfully.");
