export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    shape_hash   TEXT NOT NULL,
    analyzed_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS nodes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol_id  TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    file_id    INTEGER REFERENCES files(id),
    line_start INTEGER,
    line_end   INTEGER,
    signature  TEXT,
    pagerank   REAL,
    community  INTEGER,
    is_entry   INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS edges (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    src  INTEGER NOT NULL REFERENCES nodes(id),
    dst  INTEGER NOT NULL REFERENCES nodes(id),
    kind TEXT NOT NULL,
    key  TEXT,
    UNIQUE(src, dst, kind)
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    node_id INTEGER NOT NULL REFERENCES nodes(id),
    tag     TEXT NOT NULL,
    PRIMARY KEY (node_id, tag)
  )`,

  "CREATE INDEX IF NOT EXISTS idx_edges_src  ON edges(src)",
  "CREATE INDEX IF NOT EXISTS idx_edges_dst  ON edges(dst)",
  "CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_id)",
];
