// src/cli/build.ts
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveEdges } from "../analyzer/resolve.ts";
import { detectCommunities } from "../community/infomap.ts";
import { loadConfig } from "../config/loader.ts";
import { buildGraph } from "../graph/builder.ts";
import { computePagerank } from "../pagerank/compute.ts";
import { extractFile } from "../parser/extract.ts";
import { openDb } from "../storage/db.ts";
import {
  getFileRecord,
  isDirty,
  updateCommunity,
  updatePagerank,
  upsertEdge,
  upsertFile,
  upsertNode,
} from "../storage/writer.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function matchGlob(str: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  );
  return re.test(str);
}

function collectTsFiles(dir: string, include: string[], exclude: string[]): string[] {
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = posix(full.slice(dir.length + 1));
      if (entry.isDirectory()) {
        if (!exclude.some((pat) => matchGlob(rel, pat))) walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const included = include.some((pat) => matchGlob(rel, pat));
        const excluded = exclude.some((pat) => matchGlob(rel, pat));
        if (included && !excluded) results.push(posix(full));
      }
    }
  }
  walk(dir);
  return results;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function run(args: string[]): Promise<void> {
  const projectDir = resolve(args[0] ?? ".");
  const dbPath = join(projectDir, ".tsgraph.db");
  const cfg = loadConfig(projectDir);
  const db = openDb(dbPath);

  const allFiles = collectTsFiles(projectDir, cfg.include, cfg.exclude);
  if (allFiles.length === 0) {
    console.error(`No TypeScript files found in ${projectDir}`);
    process.exit(1);
  }

  console.log(`tsgraph build: ${allFiles.length} files in ${projectDir}`);
  console.log(`Chunk size: ${cfg.chunkSize}`);

  const allParsed: Awaited<ReturnType<typeof extractFile>>[] = [];
  const fileIds = new Map<string, bigint>();

  // Phase 1: chunked parse + write files
  for (const fileChunk of chunk(allFiles, cfg.chunkSize)) {
    const parsed = await Promise.all(
      fileChunk.map(async (absPath) => {
        const source = readFileSync(absPath, "utf8");
        return extractFile(absPath, source, projectDir);
      }),
    );

    db.transaction(() => {
      for (const file of parsed) {
        const stored = getFileRecord(db, file.path);
        if (stored && !isDirty(stored, file)) {
          fileIds.set(file.path, stored.id);
          continue;
        }
        const fileId = upsertFile(db, {
          path: file.path,
          contentHash: file.contentHash,
          shapeHash: file.shapeHash,
          analyzedAt: Date.now(),
        });
        fileIds.set(file.path, fileId);
      }
    });

    allParsed.push(...parsed);
    process.stdout.write(`  Parsed ${allParsed.length}/${allFiles.length}\r`);
  }

  console.log(`\n  Resolving edges with TypeScript compiler...`);

  // Phase 2: resolve edges (ts.createProgram) — after all parsing done
  const resolvedEdges = await resolveEdges(allParsed, projectDir);

  // Phase 3: build graph and write nodes + edges
  const { nodes, edges } = buildGraph(allParsed, resolvedEdges, fileIds);

  const nodeIds = new Map<string, bigint>();
  db.transaction(() => {
    for (const node of nodes) {
      const nid = upsertNode(db, {
        symbolId: node.symbolId,
        name: node.name,
        kind: node.kind,
        fileId: node.fileId,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
        signature: node.signature,
        isEntry: node.isEntry,
      });
      nodeIds.set(node.symbolId, nid);
    }
    for (const edge of edges) {
      const srcId = nodeIds.get(edge.srcSymbolId);
      const dstId = nodeIds.get(edge.dstSymbolId);
      if (srcId && dstId) {
        upsertEdge(db, { srcId, dstId, kind: edge.kind, key: edge.key });
      }
    }
  });

  console.log(`  ${nodes.length} nodes, ${edges.length} edges written`);

  // Phase 4: PageRank (from SQLite edge data, TS Program can now be GC'd)
  console.log("  Computing PageRank...");
  const allNodeIds = [...nodeIds.values()];
  const dbEdges = db
    .all<{ src: number; dst: number }>("SELECT src, dst FROM edges")
    .map((e) => ({ src: BigInt(e.src), dst: BigInt(e.dst) }));
  const ranks = computePagerank(allNodeIds, dbEdges);
  db.transaction(() => {
    for (const [id, rank] of ranks) updatePagerank(db, id, rank);
  });

  // Phase 5: Community detection (infomap, after PageRank)
  console.log("  Detecting communities...");
  const { communities, method } = await detectCommunities(allNodeIds, dbEdges);
  db.transaction(() => {
    for (const [id, community] of communities) updateCommunity(db, id, community);
  });
  if (method === "fallback") {
    console.log("  (infomap not found — all nodes assigned community 0)");
  }

  db.close();
  console.log(`Done. Graph written to ${dbPath}`);
}
