/**
 * nexphy context-reduction benchmark
 *
 * Measures how many tokens Claude Code would consume to answer questions
 * about symbols in a TypeScript project, comparing two approaches:
 *
 *   Naive  — read every .ts source file in the project (worst-case baseline)
 *   Nexphy — run `nexphy query <symbol>` and use only the JSON output
 *
 * Token estimate: 1 token ≈ 4 characters (GPT-4 / Claude rule of thumb).
 *
 * Usage:
 *   bun run scripts/benchmark.ts [--project <dir>] [--depth N] [--budget N]
 *
 * Defaults to benchmarking the nexphy repo itself.
 */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function collectTsFiles(dir: string, skip: string[] = []): string[] {
  const files: string[] = [];
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", ".git", "prototypes"].includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        if (!skip.some((s) => full.includes(s))) files.push(full);
      }
    }
  }
  walk(dir);
  return files;
}

function naiveTokens(files: string[]): number {
  let total = 0;
  for (const f of files) {
    try {
      total += estimateTokens(readFileSync(f, "utf8"));
    } catch {
      /* skip unreadable */
    }
  }
  return total;
}

function nexphyTokens(projectDir: string, seed: string, depth: number, budget: number): number {
  try {
    const json = execSync(
      `bun run src/cli.ts query "${seed}" --depth ${depth} --budget ${budget} --db "${join(projectDir, ".nexphy.db")}"`,
      { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return estimateTokens(json);
  } catch {
    return -1; // symbol not found
  }
}

function bar(ratio: number, width = 30): string {
  const filled = Math.round((1 - ratio) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

// ── main ──────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    project: { type: "string", default: process.cwd() },
    depth: { type: "string", default: "3" },
    budget: { type: "string", default: "8000" },
  },
  allowPositionals: false,
});

const projectDir = (values.project as string).replace(/\\/g, "/");
const depth = Number.parseInt(values.depth as string, 10);
const budget = Number.parseInt(values.budget as string, 10);

// Seeds to benchmark — exported symbols from the nexphy source
const SEEDS = [
  "computePagerank",
  "resolveEdges",
  "extractFile",
  "bfsSubgraph",
  "resolveSeed",
  "detectCommunities",
  "openDb",
  "loadConfig",
  "upsertNode",
  "buildPajek",
];

console.log("\n┌─────────────────────────────────────────────────────────────────────┐");
console.log("│                   nexphy context-reduction benchmark                │");
console.log("└─────────────────────────────────────────────────────────────────────┘\n");

// 1. Ensure graph is built
console.log(`▸ Building graph for: ${projectDir}`);
const buildStart = Date.now();
execSync(`bun run src/cli.ts build "${projectDir}"`, {
  cwd: projectDir,
  stdio: ["ignore", "ignore", "ignore"],
});
const buildMs = Date.now() - buildStart;
console.log(`  Done in ${buildMs}ms\n`);

// 2. Naive baseline — all source files
const tsFiles = collectTsFiles(projectDir, ["tests", ".test.", ".spec."]);
const naiveTotal = naiveTokens(tsFiles);
const naiveFileCount = tsFiles.length;

console.log(`▸ Naive baseline: ${naiveFileCount} source files = ${naiveTotal.toLocaleString()} tokens\n`);

// 3. Per-symbol query
console.log(
  `${"Symbol".padEnd(24)} ${"Nexphy".padStart(8)} ${"Naive".padStart(8)} ${"Reduction".padStart(10)}  Progress`,
);
console.log("─".repeat(80));

let totalNexphyTokens = 0;
let totalNaiveTokens = 0;
let successCount = 0;
const rows: { seed: string; nexphy: number; naive: number; reduction: number; ms: number }[] = [];

for (const seed of SEEDS) {
  const t0 = Date.now();
  const nTokens = nexphyTokens(projectDir, seed, depth, budget);
  const queryMs = Date.now() - t0;

  if (nTokens < 0) {
    console.log(`${"  " + seed.padEnd(22)} ${"(not found)".padStart(8)}`);
    continue;
  }

  const reduction = nTokens / naiveTotal;
  const reductionX = (1 / reduction).toFixed(1);
  const pct = ((1 - reduction) * 100).toFixed(1);

  totalNexphyTokens += nTokens;
  totalNaiveTokens += naiveTotal;
  successCount++;
  rows.push({ seed, nexphy: nTokens, naive: naiveTotal, reduction, ms: queryMs });

  console.log(
    `  ${seed.padEnd(22)} ${nTokens.toLocaleString().padStart(7)} ${naiveTotal.toLocaleString().padStart(8)} ` +
      `${(reductionX + "x").padStart(8)}  ${bar(reduction)} ${pct}% saved  ${queryMs}ms`,
  );
}

if (successCount === 0) {
  console.log("\n  No symbols found — run `nexphy build` on the project first.");
  process.exit(1);
}

// 4. Summary
const avgReduction = totalNexphyTokens / totalNaiveTokens;
const avgX = (1 / avgReduction).toFixed(1);
const avgPct = ((1 - avgReduction) * 100).toFixed(1);
const avgMs = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);

console.log("─".repeat(80));
console.log(
  `  ${"AVERAGE".padEnd(22)} ${Math.round(totalNexphyTokens / successCount).toLocaleString().padStart(7)} ` +
    `${naiveTotal.toLocaleString().padStart(8)} ${(avgX + "x").padStart(8)}  ${bar(avgReduction)} ${avgPct}% saved`,
);

console.log(`
┌──────────────────────────────────────────────────────────┐
│  Summary                                                 │
│                                                          │
│  Source files indexed : ${String(naiveFileCount).padEnd(33)}│
│  Naive context (all files) : ${String(naiveTotal.toLocaleString() + " tokens").padEnd(28)}│
│  Avg nexphy context / query : ${String(Math.round(totalNexphyTokens / successCount).toLocaleString() + " tokens").padEnd(28)}│
│  Average reduction  : ${(avgX + "x  (" + avgPct + "% fewer tokens)").padEnd(36)}│
│  Avg query latency  : ${String(avgMs + "ms").padEnd(36)}│
│  Graph build time   : ${String(buildMs + "ms").padEnd(36)}│
└──────────────────────────────────────────────────────────┘
`);
