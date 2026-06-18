// tests/unit/infomap.test.ts
import { describe, expect, test } from "bun:test";
import { detectCommunities } from "../../src/community/infomap.ts";

describe("detectCommunities", () => {
  test("empty nodeIds returns empty communities via fallback", async () => {
    const result = await detectCommunities([], []);
    expect(result.communities.size).toBe(0);
    expect(result.method).toBe("fallback");
  });

  test("fallback assigns all nodes to community 0 when infomap is absent", async () => {
    // infomap is not installed in the test environment, so we always hit the fallback path
    const nodeIds = [1n, 2n, 3n];
    const edges = [
      { src: 1n, dst: 2n },
      { src: 2n, dst: 3n },
    ];
    const result = await detectCommunities(nodeIds, edges);
    // If infomap is installed, method will be "infomap" and communities may differ — skip assertion
    if (result.method === "fallback") {
      expect(result.communities.size).toBe(3);
      for (const id of nodeIds) expect(result.communities.get(id)).toBe(0);
    } else {
      // infomap ran — verify every node has a community assigned
      for (const id of nodeIds) expect(result.communities.has(id)).toBe(true);
    }
  });

  test("is deterministic across calls (same community assignment)", async () => {
    const nodeIds = [1n, 2n, 3n, 4n];
    const edges = [
      { src: 1n, dst: 2n },
      { src: 3n, dst: 4n },
    ];
    const a = await detectCommunities(nodeIds, edges);
    const b = await detectCommunities(nodeIds, edges);
    expect(a.method).toBe(b.method);
    for (const id of nodeIds) {
      expect(a.communities.get(id)).toBe(b.communities.get(id));
    }
  });
});
