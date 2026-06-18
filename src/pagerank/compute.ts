// src/pagerank/compute.ts
const DAMPING = 0.85;
const MAX_ITERATIONS = 20;
const CONVERGENCE_EPSILON = 1e-6;

export interface PREdge {
  src: bigint;
  dst: bigint;
}

export function computePagerank(nodeIds: bigint[], edges: PREdge[]): Map<bigint, number> {
  const N = nodeIds.length;
  if (N === 0) return new Map();

  let rank = new Map<bigint, number>();
  let newRank = new Map<bigint, number>();
  const outDegree = new Map<bigint, number>();
  const inEdges = new Map<bigint, bigint[]>();

  for (const id of nodeIds) {
    rank.set(id, 1 / N);
    outDegree.set(id, 0);
    inEdges.set(id, []);
  }

  for (const e of edges) {
    if (e.src === e.dst) continue; // self-loops inflate rank without semantic meaning
    outDegree.set(e.src, (outDegree.get(e.src) ?? 0) + 1);
    const arr = inEdges.get(e.dst);
    if (arr) arr.push(e.src);
  }

  // Dangling nodes (out-degree 0) absorb probability mass without redistributing it.
  // Collect once — the set is static across iterations.
  const danglingIds = nodeIds.filter((id) => (outDegree.get(id) ?? 0) === 0);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const danglingSum = danglingIds.reduce((acc, id) => acc + (rank.get(id) ?? 0), 0);
    const danglingContrib = (DAMPING * danglingSum) / N;

    let residual = 0;
    for (const id of nodeIds) {
      let sum = 0;
      for (const src of inEdges.get(id) ?? []) {
        const deg = outDegree.get(src) ?? 1;
        sum += (rank.get(src) ?? 0) / deg;
      }
      const newR = (1 - DAMPING) / N + DAMPING * sum + danglingContrib;
      newRank.set(id, newR);
      residual += Math.abs(newR - (rank.get(id) ?? 0));
    }

    // O(1) reference swap instead of O(N) copy-back.
    [rank, newRank] = [newRank, rank];

    if (residual < CONVERGENCE_EPSILON) break;
  }

  return rank;
}
