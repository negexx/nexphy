export interface NodeRow {
  id: bigint;
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  signature: string | null;
  pagerank: number;
  community: number;
  isEntry: boolean;
}

export interface OutputEdge {
  src: string;
  dst: string;
  kind: string;
  key: string | null;
}

export interface BfsResult {
  nodes: NodeRow[];
  edges: OutputEdge[];
  truncated: boolean;
}

export interface QueryOutput {
  seed: {
    symbol_id: string;
    name: string;
    kind: string;
    file: string;
    line_start: number;
    pagerank: number;
    community: number;
  };
  nodes: QueryOutput["seed"][];
  edges: OutputEdge[];
  truncated: boolean;
  legend: { node_kinds: Record<string, string>; edge_kinds: Record<string, string> };
}
