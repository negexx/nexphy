// src/community/infomap.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CommunityResult {
  communities: Map<bigint, number>; // nodeId → community index
  method: "infomap" | "fallback";
}

function buildPajek(nodeIds: bigint[], edges: { src: bigint; dst: bigint }[]): string {
  const lines: string[] = [];
  const idxMap = new Map<bigint, number>();
  nodeIds.forEach((id, i) => {
    idxMap.set(id, i + 1);
  });

  lines.push(`*Vertices ${nodeIds.length}`);
  for (let i = 0; i < nodeIds.length; i++) lines.push(`${i + 1} "n${i + 1}"`);

  lines.push("*Arcs");
  for (const e of edges) {
    const s = idxMap.get(e.src);
    const d = idxMap.get(e.dst);
    if (s && d) lines.push(`${s} ${d} 1`);
  }

  return lines.join("\n");
}

function parseClu(content: string, nodeIds: bigint[]): Map<bigint, number> {
  const result = new Map<bigint, number>();
  for (const line of content.split("\n")) {
    if (line.startsWith("*") || line.trim() === "") continue;
    const parts = line.trim().split(/\s+/);
    const idx = Number.parseInt(parts[0], 10) - 1;
    const community = Number.parseInt(parts[1], 10);
    if (idx >= 0 && idx < nodeIds.length) {
      result.set(nodeIds[idx], community);
    }
  }
  return result;
}

export async function detectCommunities(
  nodeIds: bigint[],
  edges: { src: bigint; dst: bigint }[],
): Promise<CommunityResult> {
  if (nodeIds.length === 0) {
    return { communities: new Map(), method: "fallback" };
  }

  const workDir = join(tmpdir(), `tsgraph-infomap-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  const netFile = join(workDir, "graph.net");
  const outBase = join(workDir, "out");

  writeFileSync(netFile, buildPajek(nodeIds, edges));

  try {
    const proc = Bun.spawn(["infomap", netFile, workDir, "--clu", "--silent"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const cluFile = `${outBase}.clu`;
    if (!existsSync(cluFile)) {
      throw new Error("infomap produced no .clu output");
    }

    const communities = parseClu(readFileSync(cluFile, "utf8"), nodeIds);
    return { communities, method: "infomap" };
  } catch {
    // infomap not installed or failed — assign all nodes to community 0
    const fallback = new Map<bigint, number>();
    for (const id of nodeIds) fallback.set(id, 0);
    return { communities: fallback, method: "fallback" };
  } finally {
    try {
      rmSync(workDir, { recursive: true });
    } catch {
      /* ok */
    }
  }
}
