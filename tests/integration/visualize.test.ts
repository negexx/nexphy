import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { run as buildRun } from "../../src/cli/build.ts";
import { openDb } from "../../src/storage/db.ts";
import type { SqliteDb } from "../../src/storage/interface.ts";
import { loadGraphData } from "../../src/visualize/data.ts";
import { buildHtml } from "../../src/visualize/template.ts";

const fixtureDir = join(import.meta.dir, "../../fixtures/simple-ts");
const dbPath = join(fixtureDir, ".nexphy.db");

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      /* ok */
    }
  }
}

let db: SqliteDb;

beforeAll(async () => {
  cleanupDb();
  await buildRun([fixtureDir]);
  db = openDb(dbPath);
});

afterAll(() => {
  db.close();
  cleanupDb();
});

describe("loadGraphData", () => {
  test("returns nodes with string ids (symbol_ids)", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.nodes.length).toBeGreaterThan(0);
    for (const n of data.nodes) {
      expect(n.id).toContain("#");
    }
  });

  test("<module> nodes are converted to kind:file with filename as name", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const n of data.nodes) {
      // Raw "<module>" name must never appear — they are renamed to their filename
      expect(n.name).not.toBe("<module>");
      // file-kind nodes must have a real filename (not empty, not the raw tag)
      if (n.kind === "file") {
        expect(n.name).toMatch(/\.(ts|js|tsx|jsx|mts|mjs)$/);
      }
    }
  });

  test("edges use symbol_id strings not integers", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const e of data.edges) {
      expect(e.src).toContain("#");
      expect(e.dst).toContain("#");
    }
  });

  test("meta has correct nodeCount and edgeCount", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.meta.nodeCount).toBe(data.nodes.length);
    expect(data.meta.edgeCount).toBe(data.edges.length);
  });
});

describe("buildHtml / visualize output", () => {
  let html: string;

  beforeAll(() => {
    const data = loadGraphData(db, fixtureDir);
    html = buildHtml(data);
  });

  test("html is a complete HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>");
    expect(html).toContain("</html>");
  });

  test("html embeds graph data as GRAPH_DATA JSON", () => {
    expect(html).toContain("const GRAPH_DATA=");
    expect(html).toContain('"nodes"');
    expect(html).toContain('"edges"');
  });

  test("html loads D3 from CDN", () => {
    expect(html).toContain("d3js.org/d3.v7.min.js");
  });

  test("html contains sidebar elements", () => {
    expect(html).toContain('id="search"');
    expect(html).toContain('id="filters"');
    expect(html).toContain('id="node-info"');
  });

  test("</script> sequences in data are escaped", () => {
    // The raw JSON should not contain unescaped </script>
    const dataStart = html.indexOf("const GRAPH_DATA=");
    const dataEnd = html.indexOf(";</script>", dataStart);
    const embeddedJson = html.slice(dataStart + "const GRAPH_DATA=".length, dataEnd);
    expect(embeddedJson).not.toContain("</script>");
  });
});
