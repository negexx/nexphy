// tests/unit/pagerank.test.ts
import { describe, expect, test } from "bun:test";
import { computePagerank } from "../../src/pagerank/compute.ts";

describe("computePagerank", () => {
  test("all nodes receive positive rank", () => {
    const edges = [
      { src: 1n, dst: 2n },
      { src: 1n, dst: 3n },
    ];
    const ranks = computePagerank([1n, 2n, 3n], edges);
    for (const [, r] of ranks) expect(r).toBeGreaterThan(0);
  });

  test("node with more in-edges ranks higher", () => {
    // 1→3, 2→3, 1→2: node 3 has 2 in-edges, node 2 has 1
    const edges = [
      { src: 1n, dst: 3n },
      { src: 2n, dst: 3n },
      { src: 1n, dst: 2n },
    ];
    const ranks = computePagerank([1n, 2n, 3n], edges);
    expect(ranks.get(3n) ?? 0).toBeGreaterThan(ranks.get(2n) ?? 0);
  });

  test("is deterministic across calls", () => {
    const edges = [{ src: 1n, dst: 2n }];
    const a = computePagerank([1n, 2n], edges);
    const b = computePagerank([1n, 2n], edges);
    expect(a.get(1n)).toBeCloseTo(b.get(1n) ?? 0, 10);
    expect(a.get(2n)).toBeCloseTo(b.get(2n) ?? 0, 10);
  });

  test("isolated node still gets a rank", () => {
    const ranks = computePagerank([1n, 2n], []);
    expect(ranks.get(1n)).toBeGreaterThan(0);
    expect(ranks.get(2n)).toBeGreaterThan(0);
  });

  test("self-loops do not inflate rank", () => {
    // Node 1 self-loops; node 2 has no edges — both should be equal (no in-edges from others)
    const withSelf = computePagerank([1n, 2n], [{ src: 1n, dst: 1n }]);
    const withoutSelf = computePagerank([1n, 2n], []);
    expect(withSelf.get(1n) ?? 0).toBeCloseTo(withoutSelf.get(1n) ?? 0, 6);
  });

  test("rank sum is conserved (≈ 1) with dangling-node correction", () => {
    // Node 3 is a dangling sink — no out-edges. Without correction its mass leaks.
    const edges = [
      { src: 1n, dst: 3n },
      { src: 2n, dst: 3n },
    ];
    const ranks = computePagerank([1n, 2n, 3n], edges);
    const total = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
