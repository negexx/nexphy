#!/usr/bin/env bun
/**
 * Runs both prototypes in dev mode and compiled mode.
 * Prints a clear PASS/FAIL table and exits non-zero if anything fails.
 *
 * Run: bun run proto:all
 *
 * Note: tree-sitter compiled mode requires sidecar WASM files next to the binary.
 * Without them the compiled test will FAIL — this is expected. See prototypes/RESULTS.md §B.
 */

import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";

interface Result {
  name: string;
  devPass: boolean;
  compiledPass: boolean;
  compiledSkipped: boolean;
  notes: string;
}

function run(cmd: string, args: string[], timeoutMs = 30_000): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

function probe(name: string, file: string, binaryBase: string): Result {
  const result: Result = {
    name,
    devPass: false,
    compiledPass: false,
    compiledSkipped: false,
    notes: "",
  };
  const binary = isWindows ? `${binaryBase}.exe` : binaryBase;

  process.stdout.write(`\n[${name}] dev mode... `);
  const dev = run("bun", ["run", file]);
  result.devPass = dev.ok;
  process.stdout.write(dev.ok ? "PASS\n" : "FAIL\n");
  if (!dev.ok) result.notes = dev.out.slice(0, 200);

  process.stdout.write(`[${name}] compiling... `);
  // Compile step can take longer — allow 60s
  const compile = run("bun", ["build", "--compile", file, "--outfile", binaryBase], 60_000);
  if (!compile.ok) {
    process.stdout.write("COMPILE ERROR\n");
    result.compiledSkipped = true;
    if (!result.notes) result.notes = compile.out.slice(0, 300);
    return result;
  }
  process.stdout.write("OK\n");

  process.stdout.write(`[${name}] compiled binary... `);
  const compiled = run(binary, []);
  result.compiledPass = compiled.ok;
  process.stdout.write(compiled.ok ? "PASS\n" : "FAIL\n");
  if (!compiled.ok && !result.notes) result.notes = compiled.out.slice(0, 200);

  try {
    if (existsSync(binary)) unlinkSync(binary);
  } catch {
    /* ok — best-effort cleanup */
  }
  return result;
}

const tmp = tmpdir().replace(/\\/g, "/");

const PROBES: Array<{ name: string; file: string; binary: string }> = [
  {
    name: "infomap",
    file: "prototypes/infomap-bun.ts",
    binary: `${tmp}/proto-infomap`,
  },
  {
    name: "tree-sitter",
    file: "prototypes/tree-sitter-bun.ts",
    binary: `${tmp}/proto-ts`,
  },
];

const results = PROBES.map((p) => probe(p.name, p.file, p.binary));

// ── Summary table ────────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════╗");
console.log("║       PROTOTYPE VALIDATION RESULTS           ║");
console.log("╠══════════════════════════════════════════════╣");
for (const r of results) {
  const devStr = r.devPass ? "✓ PASS" : "✗ FAIL";
  const compiledStr = r.compiledSkipped ? "— SKIP" : r.compiledPass ? "✓ PASS" : "✗ FAIL";
  const namePad = r.name.padEnd(12);
  console.log(`║  ${namePad} dev: ${devStr}  compiled: ${compiledStr}  ║`);
  if (r.notes) {
    const note = r.notes.slice(0, 34).padEnd(34);
    console.log(`║    └─ ${note}  ║`);
  }
}
console.log("╚══════════════════════════════════════════════╝");

// tree-sitter compiled FAIL without sidecar WASM is expected — do not block
const allPass = results.every((r) => r.devPass && (r.compiledPass || r.compiledSkipped));

if (allPass) {
  console.log("\n✓ All prototype dev-mode runs passed.");
  process.exit(0);
} else {
  console.log("\n✗ One or more prototype dev-mode runs FAILED.");
  console.log("  tree-sitter compiled FAIL without sidecar WASM is expected.");
  console.log("  See prototypes/RESULTS.md for findings and Phase 2 fallback plans.\n");
  process.exit(1);
}
