// src/graph/types.ts

import type { EdgeKind } from "../analyzer/types.ts";
import type { SymbolKind } from "../parser/types.ts";

export interface GraphNode {
  symbolId: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  fileId: bigint;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  isEntry: boolean;
}

export interface GraphEdge {
  srcSymbolId: string;
  dstSymbolId: string;
  kind: EdgeKind;
  key: string | null;
}
