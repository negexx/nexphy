import { unlinkSync } from "node:fs";
import { createBunSqliteDb } from "./bun-sqlite.ts";
import type { SqliteDb } from "./interface.ts";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema.ts";

/** Table names in dependency order (dependents first) for safe DROP. */
const DROP_ORDER = ["tags", "edges", "nodes", "files"];

function applySchema(db: SqliteDb): void {
  db.transaction(() => {
    for (const stmt of SCHEMA_STATEMENTS) {
      db.run(stmt);
    }
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

export function openDb(path: string): SqliteDb {
  const db = createBunSqliteDb(path);

  // Required PRAGMAs on every open (storage.md rule)
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");

  const versionRow = db.get<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion === 0) {
    // Fresh database — apply schema
    applySchema(db);
    return db;
  }

  if (currentVersion !== SCHEMA_VERSION) {
    // Schema version mismatch — nuke and rebuild.
    // Try file-deletion first (works on Linux/macOS); fall back to in-place
    // table drop on Windows where WAL files may be locked after close().
    db.close();

    let deleted = false;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(path + suffix);
        if (suffix === "") deleted = true;
      } catch {
        /* locked or already gone */
      }
    }

    if (deleted) {
      // Main file was deleted — safe to recurse with a fresh db
      return openDb(path);
    }

    // File still locked (Windows WAL) — reset schema in-place
    const db2 = createBunSqliteDb(path);
    db2.run("PRAGMA journal_mode=WAL");
    db2.run("PRAGMA busy_timeout=5000");
    db2.transaction(() => {
      for (const table of DROP_ORDER) {
        db2.run(`DROP TABLE IF EXISTS ${table}`);
      }
      for (const stmt of SCHEMA_STATEMENTS) {
        db2.run(stmt);
      }
      db2.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    return db2;
  }

  return db;
}
