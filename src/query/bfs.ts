import type { SqliteDb } from "../storage/interface.ts";
import { type RawNodeRow, toNodeRow } from "./seed.ts";
import type { BfsResult, NodeRow, OutputEdge } from "./types.ts";

interface RawEdgeRow {
  nbr_id: number;
  nbr_symbol_id: string;
  nbr_name: string;
  nbr_kind: string;
  nbr_file_path: string;
  nbr_line_start: number;
  nbr_line_end: number | null;
  nbr_signature: string | null;
  nbr_pagerank: number;
  nbr_community: number;
  nbr_is_entry: number;
  edge_kind: string;
  edge_key: string | null;
}

const FORWARD_SQL = `
  SELECT nd.id as nbr_id, nd.symbol_id as nbr_symbol_id, nd.name as nbr_name,
         nd.kind as nbr_kind, COALESCE(f.path, '') as nbr_file_path,
         nd.line_start as nbr_line_start, nd.line_end as nbr_line_end,
         nd.signature as nbr_signature,
         COALESCE(nd.pagerank, 0) as nbr_pagerank,
         COALESCE(nd.community, 0) as nbr_community, nd.is_entry as nbr_is_entry,
         e.kind as edge_kind, e.key as edge_key
  FROM edges e
  JOIN nodes nd ON nd.id = e.dst
  LEFT JOIN files f ON f.id = nd.file_id
  WHERE e.src = ?
`;

const BACKWARD_SQL = `
  SELECT nd.id as nbr_id, nd.symbol_id as nbr_symbol_id, nd.name as nbr_name,
         nd.kind as nbr_kind, COALESCE(f.path, '') as nbr_file_path,
         nd.line_start as nbr_line_start, nd.line_end as nbr_line_end,
         nd.signature as nbr_signature,
         COALESCE(nd.pagerank, 0) as nbr_pagerank,
         COALESCE(nd.community, 0) as nbr_community, nd.is_entry as nbr_is_entry,
         e.kind as edge_kind, e.key as edge_key
  FROM edges e
  JOIN nodes nd ON nd.id = e.src
  LEFT JOIN files f ON f.id = nd.file_id
  WHERE e.dst = ?
`;

function estimateTokens(node: NodeRow): number {
  return Math.ceil(
    JSON.stringify({
      symbol_id: node.symbolId,
      name: node.name,
      kind: node.kind,
      file: node.filePath,
      line_start: node.lineStart,
      pagerank: node.pagerank,
      community: node.community,
    }).length / 4,
  );
}

function toNeighborNodeRow(r: RawEdgeRow): NodeRow {
  return toNodeRow({
    id: r.nbr_id,
    symbol_id: r.nbr_symbol_id,
    name: r.nbr_name,
    kind: r.nbr_kind,
    file_path: r.nbr_file_path,
    line_start: r.nbr_line_start,
    line_end: r.nbr_line_end,
    signature: r.nbr_signature,
    pagerank: r.nbr_pagerank,
    community: r.nbr_community,
    is_entry: r.nbr_is_entry,
  } as RawNodeRow);
}

export function bfsSubgraph(
  db: SqliteDb,
  seedId: bigint,
  opts: { depth: number; budget: number },
): BfsResult {
  const idToSymbolId = new Map<bigint, string>();
  const resultNodes: NodeRow[] = [];
  const resultEdges: OutputEdge[] = [];
  const edgeSeen = new Set<string>();
  let remainingBudget = opts.budget;
  let truncated = false;

  const seedRow = db.get<{ symbol_id: string }>(
    "SELECT symbol_id FROM nodes WHERE id = ?",
    Number(seedId),
  );
  if (seedRow) idToSymbolId.set(seedId, seedRow.symbol_id);

  let frontier: bigint[] = [seedId];

  for (let d = 0; d < opts.depth; d++) {
    const candidates = new Map<bigint, { node: NodeRow; edges: OutputEdge[] }>();

    for (const nodeId of frontier) {
      const srcSymbolId = idToSymbolId.get(nodeId) ?? "";

      const forwardRows = db.all<RawEdgeRow>(FORWARD_SQL, Number(nodeId));
      for (const r of forwardRows) {
        const nbrId = BigInt(r.nbr_id);
        const edge: OutputEdge = {
          src: srcSymbolId,
          dst: r.nbr_symbol_id,
          kind: r.edge_kind,
          key: r.edge_key,
        };
        const edgeKey = `${edge.src}|${edge.dst}|${edge.kind}`;
        if (idToSymbolId.has(nbrId)) {
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            resultEdges.push(edge);
          }
        } else {
          if (!candidates.has(nbrId))
            candidates.set(nbrId, { node: toNeighborNodeRow(r), edges: [] });
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            const candidate = candidates.get(nbrId);
            if (candidate) candidate.edges.push(edge);
          }
        }
      }

      const backwardRows = db.all<RawEdgeRow>(BACKWARD_SQL, Number(nodeId));
      for (const r of backwardRows) {
        const nbrId = BigInt(r.nbr_id);
        const dstSymbolId = idToSymbolId.get(nodeId) ?? "";
        const edge: OutputEdge = {
          src: r.nbr_symbol_id,
          dst: dstSymbolId,
          kind: r.edge_kind,
          key: r.edge_key,
        };
        const edgeKey = `${edge.src}|${edge.dst}|${edge.kind}`;
        if (idToSymbolId.has(nbrId)) {
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            resultEdges.push(edge);
          }
        } else {
          if (!candidates.has(nbrId))
            candidates.set(nbrId, { node: toNeighborNodeRow(r), edges: [] });
          if (!edgeSeen.has(edgeKey)) {
            edgeSeen.add(edgeKey);
            const candidate = candidates.get(nbrId);
            if (candidate) candidate.edges.push(edge);
          }
        }
      }
    }

    const sorted = [...candidates.values()].sort((a, b) => {
      const rankDiff = b.node.pagerank - a.node.pagerank;
      if (rankDiff !== 0) return rankDiff;
      // Tie-break by node ID ascending for determinism (CLAUDE.md convention).
      return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
    });
    const nextFrontier: bigint[] = [];

    for (const { node, edges } of sorted) {
      const cost = estimateTokens(node);
      if (remainingBudget - cost < 0) {
        truncated = true;
        continue;
      }
      remainingBudget -= cost;
      idToSymbolId.set(node.id, node.symbolId);
      resultNodes.push(node);
      resultEdges.push(...edges);
      nextFrontier.push(node.id);
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return { nodes: resultNodes, edges: resultEdges, truncated };
}
