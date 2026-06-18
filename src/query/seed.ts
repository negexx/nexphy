import type { SqliteDb } from "../storage/interface.ts";
import type { NodeRow } from "./types.ts";

const NODE_SELECT = `
  SELECT n.id, n.symbol_id, n.name, n.kind,
         COALESCE(f.path, '') as file_path,
         n.line_start, n.line_end, n.signature,
         COALESCE(n.pagerank, 0) as pagerank,
         COALESCE(n.community, 0) as community,
         n.is_entry
  FROM nodes n
  LEFT JOIN files f ON f.id = n.file_id
`;

export interface RawNodeRow {
  id: number;
  symbol_id: string;
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number | null;
  signature: string | null;
  pagerank: number;
  community: number;
  is_entry: number;
}

export function toNodeRow(r: RawNodeRow): NodeRow {
  return {
    id: BigInt(r.id),
    symbolId: r.symbol_id,
    name: r.name,
    kind: r.kind,
    filePath: r.file_path,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    signature: r.signature,
    pagerank: r.pagerank,
    community: r.community,
    isEntry: r.is_entry === 1,
  };
}

export function resolveSeed(db: SqliteDb, seed: string): NodeRow {
  // Qualified form: contains "#" (symbol_id format: "path/to/file.ts#SymbolName")
  if (seed.includes("#")) {
    const row = db.get<RawNodeRow>(`${NODE_SELECT} WHERE n.symbol_id = ?`, seed);
    if (!row) throw new Error(`No symbol found matching "${seed}"`);
    return toNodeRow(row);
  }

  // Bare name: substring match, top-1 by pagerank
  const row = db.get<RawNodeRow>(
    `${NODE_SELECT} WHERE n.name LIKE ? ORDER BY n.pagerank DESC LIMIT 1`,
    `%${seed}%`,
  );
  if (!row) throw new Error(`No symbol found matching "${seed}"`);
  return toNodeRow(row);
}
