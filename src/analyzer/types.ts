// src/analyzer/types.ts
export type EdgeKind = "imports" | "calls" | "extends" | "implements" | "uses-type" | "re-exports";

export interface ResolvedEdge {
  srcSymbolId: string;
  dstSymbolId: string;
  kind: EdgeKind;
  key: string | null;
}
