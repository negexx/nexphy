import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../storage/db.ts";
import { loadGraphData } from "../visualize/data.ts";
import { buildHtml } from "../visualize/template.ts";

function findDb(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      console.error(`Error: DB not found: ${override}`);
      process.exit(1);
    }
    return override;
  }
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".nexphy.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      console.error("error: .nexphy.db not found. Run `nexphy build <dir>` first.");
      process.exit(1);
    }
    dir = parent;
  }
}

export async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: "string", default: "graph.html" },
      db: { type: "string" },
      open: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const dbPath = findDb(values.db);
  const outputPath = resolve(values.output ?? "graph.html");
  const project = basename(dirname(resolve(dbPath)));

  const db = openDb(dbPath);
  try {
    const data = loadGraphData(db, project);
    const html = buildHtml(data);
    await Bun.write(outputPath, html);
    console.log(`Wrote ${outputPath} (${data.meta.nodeCount} nodes, ${data.meta.edgeCount} edges)`);
  } finally {
    db.close();
  }

  if (values.open) {
    const platform = process.platform;
    let cmd: string[];
    if (platform === "darwin") {
      cmd = ["open", outputPath];
    } else if (platform === "win32") {
      cmd = ["cmd", "/c", "start", '""', outputPath];
    } else {
      cmd = ["xdg-open", outputPath];
    }
    await Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" }).exited;
  }
}
