import type { SqliteDb } from "./interface.ts";

export interface FileRecord {
  path: string;
  contentHash: string;
  shapeHash: string;
  analyzedAt: number;
}

export interface NodeRecord {
  symbolId: string;
  name: string;
  kind: string;
  fileId: bigint;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  isEntry: boolean;
}

export interface EdgeRecord {
  srcId: bigint;
  dstId: bigint;
  kind: string;
  key: string | null;
}

export function upsertFile(db: SqliteDb, f: FileRecord): bigint {
  const existing = db.get<{ id: number }>("SELECT id FROM files WHERE path = ?", f.path);
  if (existing) {
    db.run(
      "UPDATE files SET content_hash=?, shape_hash=?, analyzed_at=? WHERE id=?",
      f.contentHash,
      f.shapeHash,
      f.analyzedAt,
      existing.id,
    );
    return BigInt(existing.id);
  }
  const r = db.run(
    "INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?,?,?,?)",
    f.path,
    f.contentHash,
    f.shapeHash,
    f.analyzedAt,
  );
  return r.lastInsertRowid;
}

export function upsertNode(db: SqliteDb, n: NodeRecord): bigint {
  const existing = db.get<{ id: number }>("SELECT id FROM nodes WHERE symbol_id = ?", n.symbolId);
  if (existing) {
    db.run(
      `UPDATE nodes SET name=?, kind=?, file_id=?, line_start=?, line_end=?,
       signature=?, is_entry=? WHERE id=?`,
      n.name,
      n.kind,
      Number(n.fileId),
      n.lineStart,
      n.lineEnd,
      n.signature,
      n.isEntry ? 1 : 0,
      existing.id,
    );
    return BigInt(existing.id);
  }
  const r = db.run(
    `INSERT INTO nodes (symbol_id, name, kind, file_id, line_start, line_end, signature, is_entry)
     VALUES (?,?,?,?,?,?,?,?)`,
    n.symbolId,
    n.name,
    n.kind,
    Number(n.fileId),
    n.lineStart,
    n.lineEnd,
    n.signature,
    n.isEntry ? 1 : 0,
  );
  return r.lastInsertRowid;
}

export function upsertEdge(db: SqliteDb, e: EdgeRecord): void {
  db.run(
    `INSERT OR IGNORE INTO edges (src, dst, kind, key) VALUES (?,?,?,?)`,
    Number(e.srcId),
    Number(e.dstId),
    e.kind,
    e.key,
  );
}

export function updatePagerank(db: SqliteDb, nodeId: bigint, rank: number): void {
  db.run("UPDATE nodes SET pagerank=? WHERE id=?", rank, Number(nodeId));
}

export function updateCommunity(db: SqliteDb, nodeId: bigint, community: number): void {
  db.run("UPDATE nodes SET community=? WHERE id=?", community, Number(nodeId));
}

export interface StoredFileRecord {
  id: bigint;
  contentHash: string;
  shapeHash: string;
}

export function getFileRecord(db: SqliteDb, posixPath: string): StoredFileRecord | null {
  const row = db.get<{ id: number; content_hash: string; shape_hash: string }>(
    "SELECT id, content_hash, shape_hash FROM files WHERE path = ?",
    posixPath,
  );
  if (!row) return null;
  return { id: BigInt(row.id), contentHash: row.content_hash, shapeHash: row.shape_hash };
}

export function isDirty(
  stored: StoredFileRecord,
  parsed: { contentHash: string; shapeHash: string },
): boolean {
  return stored.contentHash !== parsed.contentHash || stored.shapeHash !== parsed.shapeHash;
}
