import { unlinkSync } from "node:fs";
import type { SqliteDb } from "./interface.ts";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "./schema.ts";

// Runtime-conditional factory — resolved once at module init via top-level await.
// In Bun (dev or compiled): loads bun-sqlite. In Node.js: loads node-sqlite.
// bun build --target node marks bun:sqlite as external so the bun-sqlite chunk is
// never executed under Node.js.
const createDbImpl: (path: string) => SqliteDb =
  typeof Bun !== "undefined"
    ? (await import("./bun-sqlite.ts")).createBunSqliteDb
    : (await import("./node-sqlite.ts")).createNodeSqliteDb;

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
  const db = createDbImpl(path);

  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA busy_timeout=5000");

  const versionRow = db.get<{ user_version: number | bigint }>("PRAGMA user_version");
  const currentVersion = Number(versionRow?.user_version ?? 0);

  if (currentVersion === 0) {
    applySchema(db);
    return db;
  }

  if (currentVersion !== SCHEMA_VERSION) {
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
      return openDb(path);
    }

    const db2 = createDbImpl(path);
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
