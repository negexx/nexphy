// tests/unit/builder.test.ts
import { describe, expect, test } from "bun:test";
import type { ResolvedEdge } from "../../src/analyzer/types.ts";
import { buildGraph } from "../../src/graph/builder.ts";
import type { ParsedFile } from "../../src/parser/types.ts";

const FILE_A: ParsedFile = {
  path: "src/a.ts",
  contentHash: "c1",
  shapeHash: "s1",
  symbols: [
    {
      symbolId: "src/a.ts#foo",
      name: "foo",
      kind: "function",
      filePath: "src/a.ts",
      lineStart: 1,
      lineEnd: 3,
      signature: "function foo()",
      isEntry: true,
    },
  ],
  imports: [],
};

const FILE_B: ParsedFile = {
  path: "src/b.ts",
  contentHash: "c2",
  shapeHash: "s2",
  symbols: [
    {
      symbolId: "src/b.ts#bar",
      name: "bar",
      kind: "function",
      filePath: "src/b.ts",
      lineStart: 1,
      lineEnd: 2,
      signature: "function bar()",
      isEntry: false,
    },
  ],
  imports: [{ fromFile: "src/b.ts", toSpecifier: "./a", names: ["foo"] }],
};

const EDGES: ResolvedEdge[] = [
  { srcSymbolId: "src/b.ts#bar", dstSymbolId: "src/a.ts#foo", kind: "calls", key: null },
];

const FILE_IDS = new Map<string, bigint>([
  ["src/a.ts", 1n],
  ["src/b.ts", 2n],
]);

describe("buildGraph", () => {
  test("collects all symbols as nodes", () => {
    const { nodes } = buildGraph([FILE_A, FILE_B], EDGES, FILE_IDS);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.symbolId)).toContain("src/a.ts#foo");
    expect(nodes.map((n) => n.symbolId)).toContain("src/b.ts#bar");
  });

  test("attaches fileId from map", () => {
    const { nodes } = buildGraph([FILE_A, FILE_B], EDGES, FILE_IDS);
    const foo = nodes.find((n) => n.symbolId === "src/a.ts#foo");
    expect(foo?.fileId).toBe(1n);
  });

  test("includes resolved edges", () => {
    const { edges } = buildGraph([FILE_A, FILE_B], EDGES, FILE_IDS);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("calls");
  });

  test("deduplicates edges with same (src, dst, kind)", () => {
    const dup = [...EDGES, ...EDGES];
    const { edges } = buildGraph([FILE_A, FILE_B], dup, FILE_IDS);
    expect(edges).toHaveLength(1);
  });
});
