import type { SqliteDb } from "../storage/interface.ts";

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  pagerank: number;
  community: number;
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    project: string;
    builtAt: string;
    nodeCount: number;
    edgeCount: number;
  };
}

export function loadGraphData(db: SqliteDb, project: string): GraphData {
  const rawNodes = db.all<{
    symbol_id: string;
    name: string;
    kind: string;
    path: string;
    line_start: number | null;
    pagerank: number | null;
    community: number | null;
  }>(
    `SELECT n.symbol_id, n.name, n.kind, COALESCE(f.path, '') AS path, n.line_start, n.pagerank, n.community
     FROM nodes n
     LEFT JOIN files f ON n.file_id = f.id
     WHERE n.name NOT LIKE '<module>%'`,
  );

  const nodes: GraphNode[] = rawNodes.map((r) => ({
    id: r.symbol_id,
    name: r.name,
    kind: r.kind,
    file: r.path,
    line: r.line_start ?? 0,
    pagerank: r.pagerank ?? 0,
    community: r.community ?? 0,
  }));

  const rawEdges = db.all<{ src: string; dst: string; kind: string }>(
    `SELECT ns.symbol_id AS src, nd.symbol_id AS dst, e.kind
     FROM edges e
     JOIN nodes ns ON e.src = ns.id
     JOIN nodes nd ON e.dst = nd.id
     WHERE ns.name NOT LIKE '<module>%' AND nd.name NOT LIKE '<module>%'`,
  );

  const tsRow = db.get<{ max_at: number | null }>("SELECT MAX(analyzed_at) AS max_at FROM files");
  const builtAt = tsRow?.max_at ? new Date(tsRow.max_at).toISOString() : new Date().toISOString();

  return {
    nodes,
    edges: rawEdges,
    meta: {
      project,
      builtAt,
      nodeCount: nodes.length,
      edgeCount: rawEdges.length,
    },
  };
}
