// src/graph/builder.ts

import type { ResolvedEdge } from "../analyzer/types.ts";
import type { ParsedFile } from "../parser/types.ts";
import type { GraphEdge, GraphNode } from "./types.ts";

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGraph(
  files: ParsedFile[],
  resolvedEdges: ResolvedEdge[],
  fileIds: Map<string, bigint>,
): Graph {
  const nodes: GraphNode[] = [];

  for (const file of files) {
    const fileId = fileIds.get(file.path) ?? 0n;
    for (const sym of file.symbols) {
      nodes.push({
        symbolId: sym.symbolId,
        name: sym.name,
        kind: sym.kind,
        filePath: sym.filePath,
        fileId,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        signature: sym.signature,
        isEntry: sym.isEntry,
      });
    }
  }

  // Deduplicate edges by (src, dst, kind)
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of resolvedEdges) {
    const key = `${e.srcSymbolId}|${e.dstSymbolId}|${e.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(e);
    }
  }

  return { nodes, edges };
}
