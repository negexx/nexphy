import { parseArgs } from "node:util";

const rawArgs = process.argv.slice(2);

// Top-level: only parse -v/--version and -h/--help; everything else passes through.
const { values } = parseArgs({
  args: rawArgs,
  options: {
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

if (values.version) {
  console.log("nexphy 0.1.0");
  process.exit(0);
}

// Find the first non-flag argument as the command.
const firstPositional = rawArgs.find((a) => !a.startsWith("-"));

if (values.help || !firstPositional) {
  console.log(`
nexphy — TypeScript Code Graph CLI

Usage:
  nexphy build <dir>     Build the knowledge graph for a TypeScript project
  nexphy query <seed>    Query the graph around a symbol
  nexphy explain-edges   Show how framework edges are detected

Options:
  -v, --version  Show version
  -h, --help     Show this help
`);
  process.exit(0);
}

const command = firstPositional;
// Subcommand args: everything after the command token (preserves all flags).
const subArgs = rawArgs.slice(rawArgs.indexOf(command) + 1);

switch (command) {
  case "build":
    await import("./cli/build.ts").then((m) => m.run(subArgs));
    break;
  case "query":
    await import("./cli/query.ts").then((m) => m.run(subArgs));
    break;
  case "explain-edges":
    await import("./cli/explain-edges.ts").then((m) => m.run(subArgs));
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
