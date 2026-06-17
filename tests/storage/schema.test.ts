import { describe, expect, test } from "bun:test";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "../../src/storage/schema.ts";

describe("schema constants", () => {
  test("SCHEMA_VERSION is 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  test("SCHEMA_STATEMENTS contains all required tables", () => {
    const sql = SCHEMA_STATEMENTS.join("\n");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS files");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS nodes");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS edges");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tags");
  });

  test("SCHEMA_STATEMENTS contains required indexes", () => {
    const sql = SCHEMA_STATEMENTS.join("\n");
    expect(sql).toContain("idx_edges_src");
    expect(sql).toContain("idx_edges_dst");
    expect(sql).toContain("idx_nodes_file");
  });

  test("all PKs use AUTOINCREMENT to prevent ID reuse", () => {
    const withPk = SCHEMA_STATEMENTS.filter((s) => s.includes("INTEGER PRIMARY KEY"));
    expect(withPk.length).toBeGreaterThan(0);
    for (const stmt of withPk) {
      expect(stmt).toContain("AUTOINCREMENT");
    }
  });
});
