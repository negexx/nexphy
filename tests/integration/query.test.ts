import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { run as buildRun } from "../../src/cli/build.ts";

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

async function runQuery(args: string[]): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    const { run: queryRun } = await import("../../src/cli/query.ts");
    await queryRun([...args, "--db", dbPath]);
  } finally {
    console.log = origLog;
  }
  return JSON.parse(lines.join("\n")) as Record<string, unknown>;
}

beforeAll(async () => {
  cleanupDb();
  await buildRun([fixtureDir]);
});

afterAll(() => {
  cleanupDb();
});

describe("nexphy query", () => {
  test("resolves seed by bare name and returns JSON", async () => {
    const output = await runQuery(["greet"]);
    expect((output.seed as { name: string }).name).toBe("greet");
  });

  test("output has required top-level fields", async () => {
    const output = await runQuery(["greet"]);
    expect(output).toHaveProperty("seed");
    expect(output).toHaveProperty("nodes");
    expect(output).toHaveProperty("edges");
    expect(output).toHaveProperty("truncated");
    expect(output).toHaveProperty("legend");
  });

  test("resolves seed by qualified ID", async () => {
    const output = await runQuery(["src/index.ts#greet"]);
    expect((output.seed as { symbol_id: string }).symbol_id).toBe("src/index.ts#greet");
  });

  test("edges reference symbol_ids not integer IDs", async () => {
    const output = await runQuery(["greet"]);
    const edges = output.edges as Array<{ src: string; dst: string }>;
    for (const edge of edges) {
      expect(edge.src).toMatch(/#/);
      expect(edge.dst).toMatch(/#/);
    }
  });

  test("legend contains expected edge kinds", async () => {
    const output = await runQuery(["greet"]);
    const legend = output.legend as { edge_kinds: Record<string, string> };
    expect(legend.edge_kinds).toHaveProperty("calls");
    expect(legend.edge_kinds).toHaveProperty("imports");
  });

  test("--depth 0 returns no neighbor nodes", async () => {
    const output = await runQuery(["greet", "--depth", "0"]);
    expect((output.nodes as unknown[]).length).toBe(0);
  });

  test("explain-edges returns edge_kinds JSON", async () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    const { run: explainRun } = await import("../../src/cli/explain-edges.ts");
    explainRun([]);
    console.log = origLog;
    const parsed = JSON.parse(lines.join("\n")) as { edge_kinds: Record<string, string> };
    expect(parsed).toHaveProperty("edge_kinds");
    expect(Object.keys(parsed.edge_kinds).length).toBeGreaterThan(0);
  });
});
