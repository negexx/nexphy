import type { BfsResult, NodeRow, QueryOutput } from "../query/types.ts";
import { LEGEND } from "./legend.ts";

function nodeToOutput(n: NodeRow): QueryOutput["seed"] {
  return {
    symbol_id: n.symbolId,
    name: n.name,
    kind: n.kind,
    file: n.filePath,
    line_start: n.lineStart,
    pagerank: n.pagerank,
    community: n.community,
  };
}

export function serializeQuery(seed: NodeRow, bfs: BfsResult): QueryOutput {
  return {
    seed: nodeToOutput(seed),
    nodes: bfs.nodes.map(nodeToOutput),
    edges: bfs.edges,
    truncated: bfs.truncated,
    legend: LEGEND,
  };
}
