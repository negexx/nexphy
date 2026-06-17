// src/pagerank/compute.ts
const DAMPING = 0.85;
const ITERATIONS = 20;

export interface PREdge {
  src: bigint;
  dst: bigint;
}

export function computePagerank(nodeIds: bigint[], edges: PREdge[]): Map<bigint, number> {
  const N = nodeIds.length;
  if (N === 0) return new Map();

  const rank = new Map<bigint, number>();
  const newRank = new Map<bigint, number>();
  const outDegree = new Map<bigint, number>();
  const inEdges = new Map<bigint, bigint[]>();

  for (const id of nodeIds) {
    rank.set(id, 1 / N);
    outDegree.set(id, 0);
    inEdges.set(id, []);
  }

  for (const e of edges) {
    outDegree.set(e.src, (outDegree.get(e.src) ?? 0) + 1);
    const arr = inEdges.get(e.dst);
    if (arr) arr.push(e.src);
  }

  for (let i = 0; i < ITERATIONS; i++) {
    for (const id of nodeIds) {
      let sum = 0;
      for (const src of inEdges.get(id) ?? []) {
        const deg = outDegree.get(src) ?? 1;
        sum += (rank.get(src) ?? 0) / deg;
      }
      newRank.set(id, (1 - DAMPING) / N + DAMPING * sum);
    }
    for (const id of nodeIds) rank.set(id, newRank.get(id) ?? 0);
  }

  return rank;
}
