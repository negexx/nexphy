import { describe, expect, test } from "bun:test";
import { extractFile } from "../../src/parser/extract.ts";

const FIXTURE_TS = `
import { readFileSync } from "node:fs";
import type { Foo } from "./foo.ts";

export function greet(name: string): string {
  return "hello " + name;
}

export class Greeter {
  greet(name: string) { return greet(name); }
}

export interface Options {
  verbose: boolean;
}

export type Result = string | null;

const internal = () => {};
`.trim();

describe("extractFile", () => {
  test("extracts exported function", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const fn = file.symbols.find((s) => s.name === "greet");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.isEntry).toBe(true);
    expect(fn?.symbolId).toBe("src/index.ts#greet");
  });

  test("extracts exported class", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const cls = file.symbols.find((s) => s.name === "Greeter");
    expect(cls?.kind).toBe("class");
    expect(cls?.isEntry).toBe(true);
  });

  test("extracts exported interface", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const iface = file.symbols.find((s) => s.name === "Options");
    expect(iface?.kind).toBe("interface");
    expect(iface?.isEntry).toBe(true);
  });

  test("extracts exported type alias", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const t = file.symbols.find((s) => s.name === "Result");
    expect(t?.kind).toBe("type");
    expect(t?.isEntry).toBe(true);
  });

  test("non-exported symbol has isEntry=false", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const internal = file.symbols.find((s) => s.name === "internal");
    expect(internal?.isEntry).toBe(false);
  });

  test("extracts value imports", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const fsImport = file.imports.find((i) => i.toSpecifier === "node:fs");
    expect(fsImport).toBeDefined();
    expect(fsImport?.names).toContain("readFileSync");
  });

  test("computes contentHash as hex string", async () => {
    const file = await extractFile("/project/src/index.ts", FIXTURE_TS);
    expect(file.contentHash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("computes shapeHash deterministically", async () => {
    const a = await extractFile("/project/src/index.ts", FIXTURE_TS);
    const b = await extractFile("/project/src/index.ts", FIXTURE_TS);
    expect(a.shapeHash).toBe(b.shapeHash);
  });
});
