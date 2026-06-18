# Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `nexphy visualize <dir>` — generates a single self-contained `graph.html` with an Obsidian-style interactive force-directed graph of the full TypeScript knowledge graph.

**Architecture:** Three new source files (`src/visualize/data.ts`, `src/visualize/template.ts`, `src/cli/visualize.ts`) plus a new `case "visualize":` branch in `src/cli.ts`. The HTML file embeds all graph data as JSON and loads D3.js v7 from CDN. No server required.

**Tech Stack:** D3.js v7 (CDN), bun:sqlite (existing abstraction), TypeScript 5.x, Bun runtime.

---

## Design decisions

### Format
Self-contained HTML file. `nexphy visualize ./my-project` writes `graph.html` to the project root (overridable with `--output`). D3.js loaded from CDN (`https://d3js.org/d3.v7.min.js`) — requires internet to open, but no server to serve. All graph data inlined as JSON.

### Scope
Full graph — every node and edge from `.nexphy.db`. Click-to-focus mode highlights a node and its direct neighbors, dims everything else (exactly how Obsidian's graph view works). Click background to clear focus.

### Controls (Standard sidebar)
240px left panel:
- Header: "NEXPHY" + project path + node/edge count
- Symbol search input — dims non-matching nodes as you type
- Edge-kind filter chips — toggle any edge kind on/off
- Node info card — populates on click: name, file:line, kind badge, PageRank score, community, degree count

---

## Data shape (embedded JSON)

```typescript
interface GraphNode {
  id: string;       // symbol_id e.g. "src/query/bfs.ts#bfsSubgraph"
  name: string;     // "bfsSubgraph"
  kind: string;     // "function" | "class" | "interface" | ...
  file: string;     // "src/query/bfs.ts"
  line: number;     // line_start
  pagerank: number; // e.g. 0.0631
  community: number; // integer community ID
}

interface GraphEdge {
  src: string; // symbol_id
  dst: string; // symbol_id
  kind: string; // "imports" | "calls" | "extends" | "implements" | "uses-type" | "re-exports"
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    project: string;   // absolute project path
    builtAt: string;   // ISO 8601 timestamp
    nodeCount: number;
    edgeCount: number;
  };
}
```

---

## Visual design

### Canvas
- Background: `#0d0f14` (near-black, Obsidian-style), full viewport
- D3 zoom behavior: 0.1× – 8× scale, drag to pan

### Nodes
- Radius: `4 + 14 × log1p(pagerank) / log1p(maxPagerank)` — range 4–18px
- Color by community (8-color palette cycling):
  - 0: `#58a6ff` (blue)
  - 1: `#3fb950` (green)
  - 2: `#e3b341` (amber)
  - 3: `#f0883e` (orange)
  - 4: `#bc8cff` (purple)
  - 5: `#39d353` (teal-green)
  - 6: `#ff7b72` (red)
  - 7: `#79c0ff` (light blue)
- Labels: always visible for nodes in top-20% by PageRank; on hover for the rest
- Selected node: colored glow ring (`filter: drop-shadow(0 0 6px <communityColor>)`)

### Edges
| Kind | Color |
|---|---|
| `imports` | `#58a6ff` |
| `calls` | `#3fb950` |
| `extends` | `#e3b341` |
| `implements` | `#f0883e` |
| `uses-type` | `#bc8cff` |
| `re-exports` | `#79c0ff` |

- Arrowhead markers (SVG `<marker>`) per edge kind
- Opacity at rest: 0.4; when source or target is focused: 1.0

### Force simulation
```
d3.forceSimulation(nodes)
  .force("link",    d3.forceLink(edges).id(d => d.id).distance(60))
  .force("charge",  d3.forceManyBody().strength(-180))
  .force("center",  d3.forceCenter(width/2, height/2))
  .force("collide", d3.forceCollide().radius(d => d.r + 4))
```

---

## Interactions

| Action | Effect |
|---|---|
| Click node | Focus mode: node + direct neighbors full opacity, rest → 10% opacity. Sidebar info card populates. |
| Click background | Clear focus, restore all opacities |
| Hover node | Tooltip: name, file, kind |
| Drag node | Pin node (removes from simulation). Double-click pinned node to release. |
| Search input | As-you-type: matching nodes bright, non-matching → 10%. Clear on empty input. |
| Edge filter chip | Toggle: hide/show that edge kind. Nodes with no visible edges auto-dim. |
| Scroll | D3 zoom (0.1× – 8×) |
| Drag canvas | Pan |

---

## Source files

### New files
| File | Responsibility |
|---|---|
| `src/visualize/data.ts` | Query all nodes + edges from DB → `GraphData`. JOINs `nodes` with `files` to resolve `file` path. JOINs `edges` integer IDs with `nodes.symbol_id` so `src`/`dst` in `GraphEdge` are symbol_id strings, not integers. |
| `src/visualize/template.ts` | Build full HTML string from `GraphData` |
| `src/cli/visualize.ts` | Parse args, open DB, call data + template, write file |

### Modified files
| File | Change |
|---|---|
| `src/cli.ts` | Add `case "visualize":` branch + help text entry |

---

## CLI interface

```
nexphy visualize <dir> [--output <path>] [--open]

  <dir>            TypeScript project root (must contain .nexphy.db)
  --output <path>  Output path for graph.html  (default: <dir>/graph.html)
  --open           Open the file in the default browser after writing
  --db <path>      Override .nexphy.db location
```

Error cases:
- `.nexphy.db` not found → print "Run `nexphy build <dir>` first." and exit 1
- DB has 0 nodes → print "Graph is empty. Run `nexphy build <dir>` first." and exit 1

---

## Testing

One integration test in `tests/integration/visualize.test.ts`:
1. Build graph on the nexphy repo itself (or a small fixture)
2. Run `runVisualize(["<dir>"])` programmatically
3. Assert `graph.html` exists
4. Assert file contains `"nodeCount"` and `"edgeCount"` (JSON meta embedded)
5. Assert file contains `d3.v7` CDN URL
6. Cleanup

No unit tests for `template.ts` (pure string builder). No unit tests for `data.ts` (thin DB wrapper — covered by integration test).

---

## Out of scope (v1)

- Offline/embedded D3 (`--offline` flag)
- `nexphy serve` live-reload server
- Depth slider / min-PageRank filter (sidebar controls C)
- Export as PNG/SVG
- Filtering by file glob
