import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/storage/db.ts";
import { getFileRecord, isDirty, upsertFile } from "../../src/storage/writer.ts";

function makeTempDb() {
  const path = join(tmpdir(), `nexphy-dirty-${Date.now()}.db`);
  return { path, db: openDb(path) };
}
function cleanup(path: string) {
  for (const s of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + s);
    } catch {
      /* ok */
    }
  }
}

describe("dirty detection", () => {
  test("file not in DB → no record", () => {
    const { path, db } = makeTempDb();
    expect(getFileRecord(db, "src/new.ts")).toBeNull();
    db.close();
    cleanup(path);
  });

  test("unchanged file → isDirty returns false", () => {
    const { path, db } = makeTempDb();
    upsertFile(db, { path: "src/a.ts", contentHash: "c1", shapeHash: "s1", analyzedAt: 1 });
    const stored = getFileRecord(db, "src/a.ts");
    if (stored) {
      expect(isDirty(stored, { contentHash: "c1", shapeHash: "s1" })).toBe(false);
    } else {
      expect.unreachable();
    }
    db.close();
    cleanup(path);
  });

  test("changed content → isDirty returns true", () => {
    const { path, db } = makeTempDb();
    upsertFile(db, { path: "src/a.ts", contentHash: "c1", shapeHash: "s1", analyzedAt: 1 });
    const stored = getFileRecord(db, "src/a.ts");
    if (stored) {
      expect(isDirty(stored, { contentHash: "c2", shapeHash: "s1" })).toBe(true);
    } else {
      expect.unreachable();
    }
    db.close();
    cleanup(path);
  });
});
