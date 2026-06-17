import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.version) {
  console.log("tsgraph 0.1.0");
  process.exit(0);
}

if (values.help || positionals.length === 0) {
  console.log(`
tsgraph — TypeScript Code Graph CLI

Usage:
  tsgraph build <dir>     Build the knowledge graph for a TypeScript project
  tsgraph query <seed>    Query the graph around a symbol
  tsgraph explain-edges   Show how framework edges are detected

Options:
  -v, --version  Show version
  -h, --help     Show this help
`);
  process.exit(0);
}

const [command] = positionals;
switch (command) {
  case "build":
    await import("./cli/build.ts").then((m) => m.run(positionals.slice(1)));
    break;
  case "query":
    console.error("'query' not yet implemented (Phase 3)");
    process.exit(1);
    break;
  case "explain-edges":
    console.error("'explain-edges' not yet implemented (Phase 3)");
    process.exit(1);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
