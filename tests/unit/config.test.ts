import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loader.ts";

function makeTempDir(): string {
  const dir = join(tmpdir(), `tsgraph-cfg-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  test("returns defaults when no tsgraph.toml exists", () => {
    const dir = makeTempDir();
    const cfg = loadConfig(dir);
    expect(cfg.chunkSize).toBe(200);
    expect(cfg.include).toContain("**/*.ts");
    expect(cfg.exclude).toContain("node_modules/**");
    rmSync(dir, { recursive: true });
  });

  test("merges toml values over defaults", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "tsgraph.toml"),
      `
[build]
chunk_size = 50
`,
    );
    const cfg = loadConfig(dir);
    expect(cfg.chunkSize).toBe(50);
    expect(cfg.include).toContain("**/*.ts");
    rmSync(dir, { recursive: true });
  });

  test("custom include patterns replace defaults", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "tsgraph.toml"),
      `
[include]
patterns = ["src/**/*.ts"]
`,
    );
    const cfg = loadConfig(dir);
    expect(cfg.include).toEqual(["src/**/*.ts"]);
    rmSync(dir, { recursive: true });
  });
});
