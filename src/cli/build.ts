import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveEdges } from "../analyzer/resolve.ts";
import { detectCommunities } from "../community/infomap.ts";
import { loadConfig } from "../config/loader.ts";
import { computePagerank } from "../pagerank/compute.ts";
import { extractFile } from "../parser/extract.ts";
import type { ParsedFile } from "../parser/types.ts";
import { openDb } from "../storage/db.ts";
import {
  getFileRecord,
  isDirty,
  updateCommunity,
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

// Like matchGlob but also prunes directories matched by "dir/**" patterns.
// "node_modules/**" must exclude the "node_modules" directory itself so the
// walker never recurses into it — matchGlob alone misses this case because its
// regex requires the "/" separator that is absent on a bare dir rel-path.
function matchGlobDir(rel: string, pattern: string): boolean {
  if (matchGlob(rel, pattern)) return true;
  const prefix = pattern.replace(/\/\*\*$/, "");
  return prefix !== pattern && rel === prefix;
}

function collectTsFiles(dir: string, include: string[], exclude: string[]): string[] {
  const results: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = posix(full.slice(dir.length + 1));
      if (entry.isDirectory()) {
        if (!exclude.some((pat) => matchGlobDir(rel, pat))) walk(full);
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
  const dbPath = join(projectDir, ".nexphy.db");
  const cfg = loadConfig(projectDir);
  const db = openDb(dbPath);

  const allFiles = collectTsFiles(projectDir, cfg.include, cfg.exclude);
  if (allFiles.length === 0) {
    console.error(`No TypeScript files found in ${projectDir}`);
    process.exit(1);
  }

  console.log(`nexphy build: ${allFiles.length} files in ${projectDir}`);
  console.log(`Chunk size: ${cfg.chunkSize}`);

  // Remove file records (and their nodes) for files that no longer exist on disk.
  // Edges referencing those nodes become orphans; they are pruned in the edge phase.
  const currentPathSet = new Set(allFiles);
  const stalePaths = db
    .all<{ path: string }>("SELECT path FROM files")
    .map((r) => r.path)
    .filter((p) => !currentPathSet.has(p));
  if (stalePaths.length > 0) {
    db.transaction(() => {
      for (const p of stalePaths) {
        db.run("DELETE FROM nodes WHERE file_id = (SELECT id FROM files WHERE path = ?)", p);
        db.run("DELETE FROM files WHERE path = ?", p);
      }
    });
  }

  const buildStartedAt = Date.now();
  let parsedCount = 0;

  // Phase 1: chunked parse → write file records + nodes; ASTs discarded after each chunk.
  // Sequential (not Promise.all) — the tree-sitter Parser is a shared singleton backed by
  // a single WASM heap; concurrent parse calls corrupt each other's tree reads.
  for (const fileChunk of chunk(allFiles, cfg.chunkSize)) {
    const parsed: ParsedFile[] = [];
    for (const absPath of fileChunk) {
      const source = readFileSync(absPath, "utf8");
      parsed.push(await extractFile(absPath, source, projectDir));
    }

    db.transaction(() => {
      for (const file of parsed) {
        const stored = getFileRecord(db, file.path);
        if (stored && !isDirty(stored, file)) continue;
        const fileId = upsertFile(db, {
          path: file.path,
          contentHash: file.contentHash,
          shapeHash: file.shapeHash,
          analyzedAt: buildStartedAt,
        });
        if (stored) {
          // Dirty existing file — delete stale nodes before re-inserting so symbols
          // removed from the file don't persist in the graph.
          db.run("DELETE FROM nodes WHERE file_id = ?", Number(fileId));
        }
        // Relative path — same convention as symbolIds built in extract.ts.
        const projectDirPosix = posix(projectDir);
        const relPath = file.path.startsWith(`${projectDirPosix}/`)
          ? file.path.slice(projectDirPosix.length + 1)
          : file.path;
        // Synthetic module node: represents the file itself for import/re-export edges.
        upsertNode(db, {
          symbolId: `${relPath}#<module>`,
          name: "<module>",
          kind: "module",
          fileId,
          lineStart: 1,
          lineEnd: 1,
          signature: null,
          isEntry: false,
        });
        for (const sym of file.symbols) {
          upsertNode(db, {
            symbolId: sym.symbolId,
            name: sym.name,
            kind: sym.kind,
            fileId,
            lineStart: sym.lineStart,
            lineEnd: sym.lineEnd,
            signature: sym.signature,
            isEntry: sym.isEntry,
          });
        }
      }
    });

    parsedCount += fileChunk.length;
    process.stdout.write(`  Parsed ${parsedCount}/${allFiles.length}\r`);
  }

  console.log(`\n  Resolving edges with TypeScript compiler...`);

  // Phase 2: resolve edges — file paths only, no ASTs in memory
  const resolvedEdges = resolveEdges(allFiles, projectDir);

  // Phase 3: load all node IDs from SQLite in one sweep, then write edges.
  // Delete the entire edge table first — resolveEdges produces a fresh complete set each
  // run, so stale edges (deleted imports, renamed symbols) must not persist across builds.
  const nodeIds = new Map(
    db
      .all<{ id: number; symbol_id: string }>("SELECT id, symbol_id FROM nodes")
      .map((n) => [n.symbol_id, BigInt(n.id)]),
  );

  db.run("DELETE FROM edges");

  const seen = new Set<string>();
  let edgesWritten = 0;
  // Prepare once — re-parsing the SQL string on every call is the dominant cost at scale.
  const edgeStmt = db.prepare("INSERT OR IGNORE INTO edges (src, dst, kind, key) VALUES (?,?,?,?)");
  db.transaction(() => {
    for (const e of resolvedEdges) {
      // \0 cannot appear in file paths or TS identifiers — unambiguous dedup delimiter.
      const dedupeKey = `${e.srcSymbolId}\0${e.dstSymbolId}\0${e.kind}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const srcId = nodeIds.get(e.srcSymbolId);
      const dstId = nodeIds.get(e.dstSymbolId);
      // !== undefined rather than truthiness: 0n is falsy but a valid node ID.
      if (srcId !== undefined && dstId !== undefined) {
        edgeStmt.run(Number(srcId), Number(dstId), e.kind, e.key);
        edgesWritten++;
      }
    }
  });

  console.log(`  ${nodeIds.size} nodes, ${edgesWritten} edges written`);

  // Phase 4: PageRank (TypeScript Program is now eligible for GC)
  console.log("  Computing PageRank...");
  const allNodeIds = [...nodeIds.values()];
  const dbEdges = db
    .all<{ src: number; dst: number }>("SELECT src, dst FROM edges")
    .map((e) => ({ src: BigInt(e.src), dst: BigInt(e.dst) }));
  const ranks = computePagerank(allNodeIds, dbEdges);
  // Prepared once outside the transaction — re-parsing the SQL string per node is
  // the dominant cost at scale.
  const prStmt = db.prepare("UPDATE nodes SET pagerank=? WHERE id=?");
  db.transaction(() => {
    for (const [id, prRank] of ranks) prStmt.run(prRank, Number(id));
  });

  // Phase 5: Community detection (after PageRank)
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
