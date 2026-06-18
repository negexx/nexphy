import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { serializeQuery } from "../output/serialize.ts";
import { bfsSubgraph } from "../query/bfs.ts";
import { resolveSeed } from "../query/seed.ts";
import { openDb } from "../storage/db.ts";

function parseIntOrDefault(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function findDb(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      console.error(`error: DB not found at ${override}`);
      process.exit(1);
    }
    return override;
  }
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".tsgraph.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      console.error("error: .tsgraph.db not found. Run `tsgraph build <dir>` first.");
      process.exit(1);
    }
    dir = parent;
  }
}

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      depth: { type: "string", default: "3" },
      budget: { type: "string", default: "8000" },
      db: { type: "string" },
    },
    allowPositionals: true,
  });

  const seed = positionals[0];
  if (!seed) {
    console.error(
      "Usage: tsgraph query <seed> [--depth N] [--budget N] [--db path]\n" +
        "  <seed>  Symbol name (e.g. greet) or qualified ID (e.g. src/index.ts#greet)",
    );
    process.exit(1);
  }

  const depth = parseIntOrDefault(values.depth, 3);
  const budget = parseIntOrDefault(values.budget, 8000);
  const dbPath = findDb(values.db);
  const db = openDb(dbPath);

  try {
    const seedNode = resolveSeed(db, seed);
    const bfsResult = bfsSubgraph(db, seedNode.id, { depth, budget });
    const output = serializeQuery(seedNode, bfsResult);
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
