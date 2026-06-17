#!/usr/bin/env bun
/**
 * Prototype B: web-tree-sitter WASM grammar in Bun
 *
 * Validates that a WASM grammar can be loaded inside:
 *   1. Dev mode:      bun run prototypes/tree-sitter-bun.ts
 *   2. Compiled mode: bun build --compile prototypes/tree-sitter-bun.ts --outfile proto-ts
 *                     .\proto-ts.exe  (Windows)
 *
 * EXIT 0 = PASS, EXIT 1 = FAIL
 *
 * WASM loading strategy (in priority order):
 *   1. Sidecar next to binary: dirname(process.execPath)/tree-sitter.wasm
 *      This is the PRODUCTION approach — WASM files ship alongside the .exe
 *   2. Dev fallback: process.cwd()/node_modules/...  (works when bun run from project root)
 *   3. import.meta.dir fallback: works in dev mode only (B:\~BUN\root in compiled)
 *
 * Key finding: Bun 1.3.14 does NOT have an --asset flag for embedding WASM into compiled
 * binaries. WASM files must be distributed as side-car files next to the executable.
 * Resolution via dirname(process.execPath) is the correct approach for compiled binaries.
 *
 * See RESULTS.md §B for full test results.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

const TS_SNIPPET = `
const greet = (name: string): string => {
  return \`Hello, \${name}!\`;
};
const x: number = 42;
`.trim();

// Resolve a WASM file path using multiple candidate strategies.
// In compiled binary: import.meta.dir is "B:\\~BUN\\root" (virtual), process.cwd() is wherever
// the user runs from. Only dirname(process.execPath) reliably gives the binary's directory.
function findWasm(filename: string): string | null {
  const execDir = dirname(process.execPath);
  const candidates = [
    // 1. Sidecar next to binary (production distribution)
    join(execDir, filename),
    // 2. Dev: project root node_modules
    join(process.cwd(), "node_modules/web-tree-sitter", filename),
    join(process.cwd(), "node_modules/tree-sitter-typescript", filename),
    // 3. Dev: relative to source file (import.meta.dir only works in dev)
    join(import.meta.dir, "../node_modules/web-tree-sitter", filename),
    join(import.meta.dir, "../node_modules/tree-sitter-typescript", filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function main(): Promise<void> {
  console.log("=== Prototype B: web-tree-sitter ===");
  console.log("web-tree-sitter version: 0.25.10");
  console.log("process.execPath:", process.execPath);
  console.log("process.cwd():", process.cwd());
  console.log("import.meta.dir:", import.meta.dir);

  // --- Step 1: Parser.init() ---
  // Must be called before creating any Parser.
  // Requires the engine WASM (tree-sitter.wasm from web-tree-sitter pkg).
  // Pass it as wasmBinary so emscripten doesn't try its own path resolution
  // (which breaks in compiled binaries: tries import.meta.url-relative paths).
  const engineWasmPath = findWasm("tree-sitter.wasm");

  try {
    if (engineWasmPath) {
      const wasmBinary = readFileSync(engineWasmPath);
      await Parser.init({ wasmBinary });
      console.log("✓ Parser.init() succeeded (explicit wasmBinary from:", engineWasmPath, ")");
    } else {
      // Last resort: default emscripten resolution (may work if cwd has node_modules)
      await Parser.init();
      console.log("✓ Parser.init() succeeded (default WASM resolution)");
    }
  } catch (err) {
    console.error("✗ Parser.init() failed:", err instanceof Error ? err.message : String(err));
    console.error("");
    console.error("Fix: copy tree-sitter.wasm next to the binary:");
    console.error("  cp node_modules/web-tree-sitter/tree-sitter.wasm ./dist/");
    process.exit(1);
  }

  // --- Step 2: Locate TypeScript grammar WASM ---
  const grammarWasmPath = findWasm("tree-sitter-typescript.wasm");

  if (!grammarWasmPath) {
    console.error("✗ Could not find tree-sitter-typescript.wasm");
    console.error("  Run: bun add tree-sitter-typescript");
    console.error(
      "  Or copy: node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm next to binary",
    );
    process.exit(1);
  }

  console.log("✓ Grammar WASM located at:", grammarWasmPath);

  // --- Step 3: Load grammar ---
  let lang: Language;
  try {
    const wasmBytes = readFileSync(grammarWasmPath);
    lang = await Language.load(wasmBytes);
    console.log("✓ Language.load(Buffer) succeeded");
    console.log("  Language name:", lang.name ?? "(null — grammar omits metadata)");
    console.log("  ABI version:", lang.abiVersion);
  } catch (err) {
    console.error("✗ Language.load() failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // --- Step 4: Parse a TypeScript snippet ---
  try {
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(TS_SNIPPET);

    if (!tree) {
      console.error("✗ parser.parse() returned null");
      process.exit(1);
    }

    console.log("✓ Parsed snippet, root node type:", tree.rootNode.type);

    const arrowFns = tree.rootNode.descendantsOfType("arrow_function");
    console.log("✓ Arrow function nodes found:", arrowFns.length);
    if (arrowFns.length === 0) {
      console.error("✗ Expected at least one arrow_function node");
      process.exit(1);
    }

    const identifiers = tree.rootNode.descendantsOfType("identifier");
    console.log("  Identifiers:", identifiers.map((n) => n?.text ?? "(null)").join(", "));

    console.log("PASS");
    process.exit(0);
  } catch (err) {
    console.error("✗ Parse failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
