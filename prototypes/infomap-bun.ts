#!/usr/bin/env bun
/**
 * Prototype A: @mapequation/infomap in Bun
 *
 * Tests whether @mapequation/infomap can instantiate and .run() inside:
 *   1. dev mode:      bun run prototypes/infomap-bun.ts
 *   2. compiled mode: bun build --compile prototypes/infomap-bun.ts --outfile proto-infomap
 *                     then run .\proto-infomap.exe on Windows
 *
 * EXIT 0 = PASS, EXIT 1 = FAIL
 *
 * NOTE on the actual API (v1.9.0):
 *   - import Infomap from '@mapequation/infomap'  (default import, class)
 *   - new Infomap()  then chain .on('data'|'error'|'finished', cb)
 *   - .run(network: string, args?: string) → workerId: number  (synchronous dispatch)
 *   - .runAsync(network, args) → Promise<Result>
 *   - Internally uses URL.createObjectURL + new Blob + new Worker (browser Web Worker API)
 *     → expected to throw in Bun because URL.createObjectURL / Worker are not available
 */

import Infomap from "@mapequation/infomap";

const SMALL_NETWORK = `#source target [weight]
1 2 1.0
2 3 1.0
3 1 1.0
1 4 0.5`.trim();

async function main(): Promise<void> {
  console.log("=== Prototype A: @mapequation/infomap ===");
  console.log(`Package version: ${Infomap.__version__ ?? "unknown"}`);
  console.log("Note: this package uses URL.createObjectURL + new Worker (browser Web Worker API)");
  console.log("");

  // Step 1: Can we even instantiate?
  let infomap: InstanceType<typeof Infomap>;
  try {
    infomap = new Infomap();
    console.log("✓ new Infomap() succeeded");
  } catch (err) {
    console.error("✗ new Infomap() threw:", err instanceof Error ? err.message : String(err));
    console.error("FAIL");
    process.exit(1);
  }

  // Step 2: Try runAsync (cleaner than event wiring for a prototype)
  try {
    console.log("Attempting runAsync() …");
    const result = await Promise.race([
      infomap.runAsync({ network: SMALL_NETWORK, args: "--seed 42 --num-trials 1 --silent" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout: runAsync did not resolve within 15s")), 15_000),
      ),
    ]);

    console.log("✓ runAsync() completed");
    console.log("  result keys:", Object.keys(result as object).join(", "));
    console.log("PASS");
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("✗ runAsync() failed:", msg);

    // Distinguish expected browser-API failures from unexpected ones
    if (
      msg.includes("URL") ||
      msg.includes("Worker") ||
      msg.includes("Blob") ||
      msg.includes("createObjectURL") ||
      msg.includes("not defined") ||
      msg.includes("is not a constructor")
    ) {
      console.error(
        "  → Expected failure: package requires browser Web Worker API (URL.createObjectURL / Worker)",
      );
      console.error("  → Fallback plan: use native infomap CLI subprocess instead");
    } else {
      console.error("  → Unexpected error — investigate further");
    }

    console.error("FAIL");
    process.exit(1);
  }
}

main();
