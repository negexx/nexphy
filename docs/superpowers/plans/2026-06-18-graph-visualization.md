# Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `nexphy visualize <dir>` — generates a single self-contained `graph.html` with an Obsidian-style interactive force-directed graph of the full TypeScript knowledge graph.

**Architecture:** Three new source files handle data extraction (`src/visualize/data.ts`), HTML generation (`src/visualize/template.ts`), and CLI dispatch (`src/cli/visualize.ts`). `src/cli.ts` gets a new `case "visualize":` branch. The output is a single HTML file with D3.js v7 loaded from CDN and all graph data inlined as JSON.

**Tech Stack:** D3.js v7 (CDN), bun:sqlite via existing `SqliteDb` abstraction, TypeScript 5.x, Bun runtime.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/visualize/data.ts` | Create | Types (`GraphNode`, `GraphEdge`, `GraphData`) + `loadGraphData(db, project)` |
| `src/visualize/template.ts` | Create | `buildHtml(data: GraphData): string` — full HTML with D3 force graph |
| `src/cli/visualize.ts` | Create | `run(args)` — parse flags, find DB, load data, write file, optional `--open` |
| `src/cli.ts` | Modify | Add `case "visualize":` + update help text |
| `tests/integration/visualize.test.ts` | Create | Integration test: build fixture → visualize → assert output |

---

## Task 1: `src/visualize/data.ts` — graph data extractor

**Files:**
- Create: `src/visualize/data.ts`
- Test: `tests/integration/visualize.test.ts` (partial — written now, extended in Task 4)

### Context

The SQLite schema (from `src/storage/schema.ts`):
- `nodes(id, symbol_id, name, kind, file_id, line_start, pagerank, community)`
- `files(id, path, ...)`
- `edges(src, dst, kind)` — `src`/`dst` are integer node IDs

`loadGraphData` must JOIN `nodes → files` to resolve `file` paths and JOIN `edges → nodes` twice to convert integer IDs to `symbol_id` strings. Filter out synthetic `<module>` nodes (they exist for import tracking, not meaningful to visualise).

The DB abstraction is at `src/storage/interface.ts`. Open with `openDb(path)` from `src/storage/db.ts`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/visualize.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { run as buildRun } from "../../src/cli/build.ts";
import { loadGraphData } from "../../src/visualize/data.ts";
import { openDb } from "../../src/storage/db.ts";
import type { SqliteDb } from "../../src/storage/interface.ts";

const fixtureDir = join(import.meta.dir, "../../fixtures/simple-ts");
const dbPath = join(fixtureDir, ".nexphy.db");

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch { /* ok */ }
  }
}

let db: SqliteDb;

beforeAll(async () => {
  cleanupDb();
  await buildRun([fixtureDir]);
  db = openDb(dbPath);
});

afterAll(() => {
  db.close();
  cleanupDb();
});

describe("loadGraphData", () => {
  test("returns nodes with string ids (symbol_ids)", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.nodes.length).toBeGreaterThan(0);
    for (const n of data.nodes) {
      expect(n.id).toContain("#");
    }
  });

  test("no <module> nodes in output", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const n of data.nodes) {
      expect(n.name).not.toMatch(/^<module/);
    }
  });

  test("edges use symbol_id strings not integers", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const e of data.edges) {
      expect(e.src).toContain("#");
      expect(e.dst).toContain("#");
    }
  });

  test("meta has correct nodeCount and edgeCount", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.meta.nodeCount).toBe(data.nodes.length);
    expect(data.meta.edgeCount).toBe(data.edges.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test tests/integration/visualize.test.ts
```

Expected: error — `Cannot find module '../../src/visualize/data.ts'`

- [ ] **Step 3: Create `src/visualize/data.ts`**

```typescript
import type { SqliteDb } from "../storage/interface.ts";

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  pagerank: number;
  community: number;
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    project: string;
    builtAt: string;
    nodeCount: number;
    edgeCount: number;
  };
}

export function loadGraphData(db: SqliteDb, project: string): GraphData {
  const rawNodes = db.all<{
    symbol_id: string;
    name: string;
    kind: string;
    path: string;
    line_start: number | null;
    pagerank: number | null;
    community: number | null;
  }>(
    `SELECT n.symbol_id, n.name, n.kind, f.path, n.line_start, n.pagerank, n.community
     FROM nodes n
     JOIN files f ON n.file_id = f.id
     WHERE n.name NOT LIKE '<module>%'`,
  );

  const nodes: GraphNode[] = rawNodes.map((r) => ({
    id: r.symbol_id,
    name: r.name,
    kind: r.kind,
    file: r.path,
    line: r.line_start ?? 0,
    pagerank: r.pagerank ?? 0,
    community: r.community ?? 0,
  }));

  const rawEdges = db.all<{ src: string; dst: string; kind: string }>(
    `SELECT ns.symbol_id AS src, nd.symbol_id AS dst, e.kind
     FROM edges e
     JOIN nodes ns ON e.src = ns.id
     JOIN nodes nd ON e.dst = nd.id
     WHERE ns.name NOT LIKE '<module>%' AND nd.name NOT LIKE '<module>%'`,
  );

  return {
    nodes,
    edges: rawEdges,
    meta: {
      project,
      builtAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: rawEdges.length,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test tests/integration/visualize.test.ts
```

Expected: the `loadGraphData` describe block passes (4 tests). The rest of the file will error until Task 2/3 are complete — that is fine, this is a partial test file.

- [ ] **Step 5: Commit**

```bash
git add src/visualize/data.ts tests/integration/visualize.test.ts
git commit -m "feat: visualize/data — GraphData types and DB extractor"
```

---

## Task 2: `src/visualize/template.ts` — HTML builder

**Files:**
- Create: `src/visualize/template.ts`

No unit tests — this is a pure string builder. Covered by the integration test in Task 4.

### Context

`buildHtml(data: GraphData): string` returns a complete HTML document:
- Left sidebar: 240px, dark panel — header, search input, edge-kind chips, node info card
- Right: full-screen SVG with D3.js v7 force simulation
- All CSS/JS inlined in the document; graph data embedded as `const GRAPH_DATA = {...};`
- D3 loaded from CDN (`https://d3js.org/d3.v7.min.js`)
- Nodes: radius by PageRank (4–18px), color by community (8-color palette)
- Edges: colored by kind, arrowhead markers
- Interactions: click-to-focus, search, edge-kind filter, drag-to-pin, dblclick-to-release

Important escaping rule: inside the outer TypeScript template literal, any JavaScript template literal that must appear in the HTML output uses `\`` and `\${}` so TypeScript does NOT interpolate them.

- [ ] **Step 1: Create `src/visualize/template.ts`**

```typescript
import type { GraphData } from "./data.ts";

const EDGE_COLORS: Record<string, string> = {
  imports: "#58a6ff",
  calls: "#3fb950",
  extends: "#e3b341",
  implements: "#f0883e",
  "uses-type": "#bc8cff",
  "re-exports": "#79c0ff",
};

const COMMUNITY_COLORS = [
  "#58a6ff",
  "#3fb950",
  "#e3b341",
  "#f0883e",
  "#bc8cff",
  "#39d353",
  "#ff7b72",
  "#79c0ff",
];

export function buildHtml(data: GraphData): string {
  const dataJson = JSON.stringify(data);
  const edgeKinds = [...new Set(data.edges.map((e) => e.kind))].sort();
  const filterChips = edgeKinds
    .map((kind) => {
      const color = EDGE_COLORS[kind] ?? "#888";
      return `<button class="chip active" data-kind="${kind}" style="--chip-color:${color}" onclick="toggleKind('${kind}', this)">${kind}</button>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>nexphy — ${data.meta.project}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0f14;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;display:flex;height:100vh;overflow:hidden}
#sidebar{width:240px;min-width:240px;background:#111318;border-right:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden}
#sidebar-header{padding:14px 14px 10px;border-bottom:1px solid #21262d}
#sidebar-header .logo{font-weight:700;font-size:11px;letter-spacing:2px;color:#58a6ff}
#sidebar-header .meta{display:block;font-size:11px;color:#6e7681;margin-top:4px;word-break:break-all}
#search-wrap{padding:10px 12px;border-bottom:1px solid #21262d}
#search{width:100%;background:#1c2128;border:1px solid #30363d;border-radius:6px;padding:6px 10px;color:#e6edf3;font-size:12px;outline:none}
#search:focus{border-color:#58a6ff}
#search::placeholder{color:#484f58}
#filters-wrap{padding:10px 12px;border-bottom:1px solid #21262d}
#filters-label{font-size:10px;font-weight:600;letter-spacing:1px;color:#6e7681;text-transform:uppercase;margin-bottom:8px}
#filters{display:flex;flex-wrap:wrap;gap:5px}
.chip{border:none;border-radius:12px;padding:3px 10px;font-size:11px;cursor:pointer;background:var(--chip-color);color:#fff;font-weight:500;transition:opacity .15s}
.chip:not(.active){background:#21262d;color:#6e7681}
#node-info{flex:1;padding:12px;overflow-y:auto}
#node-info .hint{color:#484f58;font-size:12px}
.info-name{font-size:14px;font-weight:600;color:#e6edf3;word-break:break-all}
.info-file{font-size:11px;color:#6e7681;margin-top:4px;word-break:break-all}
.info-badge{display:inline-block;background:#21262d;border-radius:4px;padding:2px 8px;font-size:11px;color:#8b949e;margin-top:6px}
.info-row{display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid #21262d}
.info-key{color:#6e7681;font-size:11px}
.info-val{color:#e6edf3;font-size:11px;font-weight:500}
#graph-wrap{flex:1;position:relative;overflow:hidden}
svg{width:100%;height:100%}
.node circle{cursor:pointer}
.node text{pointer-events:none;font-size:10px;fill:#e6edf3;paint-order:stroke;stroke:#0d0f14;stroke-width:3px}
#tooltip{position:fixed;background:#1c2128;border:1px solid #30363d;border-radius:6px;padding:8px 10px;font-size:12px;pointer-events:none;display:none;z-index:100;max-width:260px}
.t-name{font-weight:600;color:#e6edf3}
.t-file{color:#6e7681;font-size:11px;margin-top:2px}
.t-kind{color:#8b949e;font-size:11px}
</style>
</head>
<body>
<div id="sidebar">
  <div id="sidebar-header">
    <span class="logo">NEXPHY</span>
    <span class="meta">${data.meta.project}</span>
    <span class="meta">${data.meta.nodeCount} nodes · ${data.meta.edgeCount} edges</span>
  </div>
  <div id="search-wrap">
    <input id="search" type="text" placeholder="search symbol…" oninput="onSearch(this.value)">
  </div>
  <div id="filters-wrap">
    <div id="filters-label">Edge kinds</div>
    <div id="filters">${filterChips}</div>
  </div>
  <div id="node-info"><p class="hint">Click a node to see details</p></div>
</div>
<div id="graph-wrap"><svg id="graph"></svg></div>
<div id="tooltip"></div>
<script>const GRAPH_DATA=${dataJson};</script>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function(){
  const COMMUNITY_COLORS=${JSON.stringify(COMMUNITY_COLORS)};
  const EDGE_COLORS=${JSON.stringify(EDGE_COLORS)};
  const nodes=GRAPH_DATA.nodes.map(function(d){return Object.assign({},d);});
  const edges=GRAPH_DATA.edges.map(function(d){return Object.assign({},d);});
  const nodeById=new Map(nodes.map(function(n){return [n.id,n];}));
  const links=edges
    .filter(function(e){return nodeById.has(e.src)&&nodeById.has(e.dst);})
    .map(function(e){return {source:nodeById.get(e.src),target:nodeById.get(e.dst),kind:e.kind};});
  const maxPR=Math.max.apply(null,nodes.map(function(n){return n.pagerank;}).concat([0.001]));
  function nodeRadius(d){return 4+14*Math.log1p(d.pagerank)/Math.log1p(maxPR);}
  function nodeColor(d){return COMMUNITY_COLORS[d.community%COMMUNITY_COLORS.length];}
  const sorted=nodes.slice().sort(function(a,b){return b.pagerank-a.pagerank;});
  const topN=Math.max(1,Math.floor(nodes.length*0.2));
  const prThreshold=sorted[topN-1]?sorted[topN-1].pagerank:0;
  const svg=d3.select('#graph');
  function W(){return svg.node().clientWidth;}
  function H(){return svg.node().clientHeight;}
  const g=svg.append('g');
  const zoom=d3.zoom().scaleExtent([0.1,8]).on('zoom',function(e){g.attr('transform',e.transform);});
  svg.call(zoom);
  svg.on('click',function(event){
    if(event.target===svg.node()||event.target.tagName==='svg')clearFocus();
  });
  const defs=svg.append('defs');
  const kinds=[...new Set(links.map(function(l){return l.kind;}))];
  kinds.forEach(function(kind){
    const color=EDGE_COLORS[kind]||'#888';
    defs.append('marker')
      .attr('id','arrow-'+kind)
      .attr('viewBox','0 -4 8 8').attr('refX',8).attr('refY',0)
      .attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto')
      .append('path').attr('d','M0,-4L8,0L0,4').attr('fill',color).attr('opacity',0.7);
  });
  const link=g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke',function(d){return EDGE_COLORS[d.kind]||'#888';})
    .attr('stroke-opacity',0.4)
    .attr('stroke-width',function(d){return d.kind==='imports'?1.5:1;})
    .attr('marker-end',function(d){return 'url(#arrow-'+d.kind+')';});
  const node=g.append('g').selectAll('g').data(nodes).join('g').attr('class','node')
    .call(d3.drag()
      .on('start',function(event,d){if(!event.active)simulation.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
      .on('drag',function(event,d){d.fx=event.x;d.fy=event.y;})
      .on('end',function(event){if(!event.active)simulation.alphaTarget(0);}))
    .on('click',function(event,d){event.stopPropagation();onNodeClick(d);})
    .on('mouseenter',function(event,d){showTooltip(event,d);})
    .on('mouseleave',hideTooltip)
    .on('dblclick',function(event,d){d.fx=null;d.fy=null;simulation.alpha(0.1).restart();});
  node.append('circle')
    .attr('r',nodeRadius)
    .attr('fill',nodeColor)
    .attr('stroke',nodeColor)
    .attr('stroke-width',0)
    .attr('opacity',1);
  node.append('text')
    .attr('dy',function(d){return -nodeRadius(d)-3;})
    .attr('text-anchor','middle')
    .text(function(d){return d.name;})
    .attr('opacity',function(d){return d.pagerank>=prThreshold?0.85:0;});
  const simulation=d3.forceSimulation(nodes)
    .force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(60))
    .force('charge',d3.forceManyBody().strength(-180))
    .force('center',d3.forceCenter(W()/2,H()/2))
    .force('collide',d3.forceCollide().radius(function(d){return nodeRadius(d)+4;}))
    .on('tick',ticked);
  function ticked(){
    link
      .attr('x1',function(d){return d.source.x;})
      .attr('y1',function(d){return d.source.y;})
      .attr('x2',function(d){
        var r=nodeRadius(d.target),dx=d.target.x-d.source.x,dy=d.target.y-d.source.y,dist=Math.sqrt(dx*dx+dy*dy)||1;
        return d.target.x-(dx/dist)*(r+6);
      })
      .attr('y2',function(d){
        var r=nodeRadius(d.target),dx=d.target.x-d.source.x,dy=d.target.y-d.source.y,dist=Math.sqrt(dx*dx+dy*dy)||1;
        return d.target.y-(dy/dist)*(r+6);
      });
    node.attr('transform',function(d){return 'translate('+d.x+','+d.y+')';});
  }
  var focusedId=null;
  var activeKinds=new Set(kinds);
  var searchTerm='';
  function onNodeClick(d){
    if(focusedId===d.id){clearFocus();return;}
    focusedId=d.id;
    var neighborIds=new Set([d.id]);
    links.forEach(function(l){
      if(l.source.id===d.id)neighborIds.add(l.target.id);
      if(l.target.id===d.id)neighborIds.add(l.source.id);
    });
    node.selectAll('circle').attr('opacity',function(n){return neighborIds.has(n.id)?1:0.08;});
    node.selectAll('text').attr('opacity',function(n){
      if(!neighborIds.has(n.id))return 0;
      return(n.id===d.id||n.pagerank>=prThreshold)?0.85:0.7;
    });
    link.attr('stroke-opacity',function(l){
      return(l.source.id===d.id||l.target.id===d.id)&&activeKinds.has(l.kind)?0.9:0.04;
    });
    showNodeInfo(d);
  }
  function clearFocus(){
    focusedId=null;
    applyFilters();
    document.getElementById('node-info').innerHTML='<p class="hint">Click a node to see details</p>';
  }
  function showNodeInfo(d){
    var degree=links.filter(function(l){return l.source.id===d.id||l.target.id===d.id;}).length;
    document.getElementById('node-info').innerHTML=
      '<div class="info-name">'+d.name+'</div>'+
      '<div class="info-file">'+d.file+':'+d.line+'</div>'+
      '<span class="info-badge">'+d.kind+'</span>'+
      '<div class="info-row"><span class="info-key">PageRank</span><span class="info-val">'+d.pagerank.toFixed(4)+'</span></div>'+
      '<div class="info-row"><span class="info-key">Community</span><span class="info-val">'+d.community+'</span></div>'+
      '<div class="info-row"><span class="info-key">Edges</span><span class="info-val">'+degree+'</span></div>';
  }
  var tooltip=document.getElementById('tooltip');
  function showTooltip(event,d){
    tooltip.innerHTML='<div class="t-name">'+d.name+'</div><div class="t-file">'+d.file+':'+d.line+'</div><div class="t-kind">'+d.kind+'</div>';
    tooltip.style.display='block';
    tooltip.style.left=(event.clientX+14)+'px';
    tooltip.style.top=(event.clientY-10)+'px';
  }
  function hideTooltip(){tooltip.style.display='none';}
  window.onSearch=function(val){searchTerm=val.trim().toLowerCase();applyFilters();};
  window.toggleKind=function(kind,btn){
    if(activeKinds.has(kind)){activeKinds.delete(kind);btn.classList.remove('active');}
    else{activeKinds.add(kind);btn.classList.add('active');}
    applyFilters();
  };
  function applyFilters(){
    if(focusedId)return;
    var visibleIds=new Set();
    if(searchTerm){
      nodes.forEach(function(n){if(n.name.toLowerCase().indexOf(searchTerm)!==-1)visibleIds.add(n.id);});
    }else{
      nodes.forEach(function(n){visibleIds.add(n.id);});
    }
    var nodesWithVisibleEdge=new Set();
    links.forEach(function(l){
      if(activeKinds.has(l.kind)){nodesWithVisibleEdge.add(l.source.id);nodesWithVisibleEdge.add(l.target.id);}
    });
    var hasAnyEdge=new Set();
    links.forEach(function(l){hasAnyEdge.add(l.source.id);hasAnyEdge.add(l.target.id);});
    node.selectAll('circle').attr('opacity',function(n){
      if(!visibleIds.has(n.id))return 0.05;
      if(hasAnyEdge.has(n.id)&&!nodesWithVisibleEdge.has(n.id))return 0.1;
      return 1;
    });
    node.selectAll('text').attr('opacity',function(n){
      if(!visibleIds.has(n.id))return 0;
      return n.pagerank>=prThreshold?0.85:0;
    });
    link.attr('stroke-opacity',function(l){
      return activeKinds.has(l.kind)&&visibleIds.has(l.source.id)&&visibleIds.has(l.target.id)?0.4:0;
    });
  }
  window.addEventListener('resize',function(){
    simulation.force('center',d3.forceCenter(W()/2,H()/2));
    simulation.alpha(0.1).restart();
  });
})();
</script>
</body>
</html>`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/visualize/template.ts
git commit -m "feat: visualize/template — Obsidian-style D3 force graph HTML builder"
```

---

## Task 3: `src/cli/visualize.ts` — CLI entry point

**Files:**
- Create: `src/cli/visualize.ts`

### Context

Follows exactly the same pattern as `src/cli/query.ts`. Reuses `findDb` logic (copy it — don't import from query, the functions are module-private). Uses `openDb` from `src/storage/db.ts`. Imports `loadGraphData` and `buildHtml`.

Flags:
- `<dir>` positional — project directory (used for `--db` discovery and `meta.project`)
- `--output <path>` — output path (default: `<dir>/graph.html`)
- `--db <path>` — override `.nexphy.db` location
- `--open` — open the file in the system browser after writing

Open browser cross-platform: use `Bun.spawn(["open", path])` on macOS, `Bun.spawn(["xdg-open", path])` on Linux, `Bun.spawn(["cmd", "/c", "start", "", path])` on Windows. Detect with `process.platform`.

- [ ] **Step 1: Create `src/cli/visualize.ts`**

```typescript
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../storage/db.ts";
import { loadGraphData } from "../visualize/data.ts";
import { buildHtml } from "../visualize/template.ts";

function findDb(dir: string, override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      console.error(`error: DB not found at ${override}`);
      process.exit(1);
    }
    return override;
  }
  let cur = resolve(dir);
  while (true) {
    const candidate = join(cur, ".nexphy.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) {
      console.error("error: .nexphy.db not found. Run `nexphy build <dir>` first.");
      process.exit(1);
    }
    cur = parent;
  }
}

function openBrowser(path: string): void {
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", path]
      : process.platform === "darwin"
        ? ["open", path]
        : ["xdg-open", path];
  Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] });
}

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: "string" },
      db: { type: "string" },
      open: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const dir = positionals[0];
  if (!dir) {
    console.error(
      "Usage: nexphy visualize <dir> [--output path] [--open] [--db path]\n" +
        "  <dir>  TypeScript project root (must contain .nexphy.db)",
    );
    process.exit(1);
  }

  const absDir = resolve(dir);
  const dbPath = findDb(absDir, values.db);
  const outputPath = values.output ?? join(absDir, "graph.html");

  const db = openDb(dbPath);
  let html: string;
  try {
    const data = loadGraphData(db, absDir.replace(/\\/g, "/"));
    if (data.nodes.length === 0) {
      console.error("error: Graph is empty. Run `nexphy build <dir>` first.");
      process.exit(1);
    }
    html = buildHtml(data);
  } finally {
    db.close();
  }

  writeFileSync(outputPath, html, "utf8");
  console.log(`nexphy visualize: ${outputPath} (${data.meta.nodeCount} nodes, ${data.meta.edgeCount} edges)`);

  if (values.open) openBrowser(outputPath);
}
```

Wait — there is a TypeScript error in the snippet above: `data` is used after the `finally` block but declared inside `try`. Fix it by declaring `data` and `html` with `let` before the try block:

```typescript
  const db = openDb(dbPath);
  let graphData: ReturnType<typeof loadGraphData>;
  let html: string;
  try {
    graphData = loadGraphData(db, absDir.replace(/\\/g, "/"));
    if (graphData.nodes.length === 0) {
      console.error("error: Graph is empty. Run `nexphy build <dir>` first.");
      process.exit(1);
    }
    html = buildHtml(graphData);
  } finally {
    db.close();
  }

  writeFileSync(outputPath, html!, "utf8");
  console.log(
    `nexphy visualize: ${outputPath} (${graphData!.meta.nodeCount} nodes, ${graphData!.meta.edgeCount} edges)`,
  );

  if (values.open) openBrowser(outputPath);
```

The full correct file is:

```typescript
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../storage/db.ts";
import { loadGraphData } from "../visualize/data.ts";
import { buildHtml } from "../visualize/template.ts";

function findDb(dir: string, override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      console.error(`error: DB not found at ${override}`);
      process.exit(1);
    }
    return override;
  }
  let cur = resolve(dir);
  while (true) {
    const candidate = join(cur, ".nexphy.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) {
      console.error("error: .nexphy.db not found. Run `nexphy build <dir>` first.");
      process.exit(1);
    }
    cur = parent;
  }
}

function openBrowser(path: string): void {
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", path]
      : process.platform === "darwin"
        ? ["open", path]
        : ["xdg-open", path];
  Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] });
}

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: "string" },
      db: { type: "string" },
      open: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const dir = positionals[0];
  if (!dir) {
    console.error(
      "Usage: nexphy visualize <dir> [--output path] [--open] [--db path]\n" +
        "  <dir>  TypeScript project root (must contain .nexphy.db)",
    );
    process.exit(1);
  }

  const absDir = resolve(dir);
  const dbPath = findDb(absDir, values.db);
  const outputPath = values.output ?? join(absDir, "graph.html");

  const db = openDb(dbPath);
  let graphData: ReturnType<typeof loadGraphData>;
  let html: string;
  try {
    graphData = loadGraphData(db, absDir.replace(/\\/g, "/"));
    if (graphData.nodes.length === 0) {
      console.error("error: Graph is empty. Run `nexphy build <dir>` first.");
      process.exit(1);
    }
    html = buildHtml(graphData);
  } finally {
    db.close();
  }

  writeFileSync(outputPath, html!, "utf8");
  console.log(
    `nexphy visualize: ${outputPath} (${graphData!.meta.nodeCount} nodes, ${graphData!.meta.edgeCount} edges)`,
  );

  if (values.open) openBrowser(outputPath);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/visualize.ts
git commit -m "feat: cli/visualize — nexphy visualize <dir> CLI entry point"
```

---

## Task 4: Wire into `src/cli.ts` + integration test + full verification

**Files:**
- Modify: `src/cli.ts`
- Extend: `tests/integration/visualize.test.ts`

- [ ] **Step 1: Add `visualize` to `src/cli.ts`**

Replace the help text block and switch:

```typescript
if (values.help || !firstPositional) {
  console.log(`
nexphy — TypeScript Code Graph CLI

Usage:
  nexphy build <dir>          Build the knowledge graph for a TypeScript project
  nexphy query <seed>         Query the graph around a symbol
  nexphy visualize <dir>      Generate an interactive graph.html
  nexphy explain-edges        Show how framework edges are detected

Options:
  -v, --version  Show version
  -h, --help     Show this help
`);
  process.exit(0);
}
```

And add the case to the switch:

```typescript
switch (command) {
  case "build":
    await import("./cli/build.ts").then((m) => m.run(subArgs));
    break;
  case "query":
    await import("./cli/query.ts").then((m) => m.run(subArgs));
    break;
  case "visualize":
    await import("./cli/visualize.ts").then((m) => m.run(subArgs));
    break;
  case "explain-edges":
    await import("./cli/explain-edges.ts").then((m) => m.run(subArgs));
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
```

- [ ] **Step 2: Extend `tests/integration/visualize.test.ts` with the HTML output tests**

Append this `describe` block to the existing file (after the `loadGraphData` block):

```typescript
import { existsSync, readFileSync } from "node:fs";
import { run as visualizeRun } from "../../src/cli/visualize.ts";

// Note: db and fixture setup is shared from the beforeAll/afterAll above.

describe("nexphy visualize", () => {
  const outputPath = join(fixtureDir, "graph.html");

  afterEach(() => {
    try { unlinkSync(outputPath); } catch { /* ok */ }
  });

  test("writes graph.html to project dir by default", async () => {
    await visualizeRun([fixtureDir, "--db", dbPath]);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("graph.html contains embedded nodeCount in JSON meta", async () => {
    await visualizeRun([fixtureDir, "--db", dbPath]);
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain('"nodeCount"');
    expect(html).toContain('"edgeCount"');
  });

  test("graph.html loads D3 from CDN", async () => {
    await visualizeRun([fixtureDir, "--db", dbPath]);
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("d3.v7.min.js");
  });

  test("--output writes to specified path", async () => {
    const customPath = join(fixtureDir, "custom-graph.html");
    try {
      await visualizeRun([fixtureDir, "--db", dbPath, "--output", customPath]);
      expect(existsSync(customPath)).toBe(true);
    } finally {
      try { unlinkSync(customPath); } catch { /* ok */ }
    }
  });
});
```

The full updated `tests/integration/visualize.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { run as buildRun } from "../../src/cli/build.ts";
import { run as visualizeRun } from "../../src/cli/visualize.ts";
import { loadGraphData } from "../../src/visualize/data.ts";
import { openDb } from "../../src/storage/db.ts";
import type { SqliteDb } from "../../src/storage/interface.ts";

const fixtureDir = join(import.meta.dir, "../../fixtures/simple-ts");
const dbPath = join(fixtureDir, ".nexphy.db");

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch { /* ok */ }
  }
}

let db: SqliteDb;

beforeAll(async () => {
  cleanupDb();
  await buildRun([fixtureDir]);
  db = openDb(dbPath);
});

afterAll(() => {
  db.close();
  cleanupDb();
});

describe("loadGraphData", () => {
  test("returns nodes with string ids (symbol_ids)", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.nodes.length).toBeGreaterThan(0);
    for (const n of data.nodes) {
      expect(n.id).toContain("#");
    }
  });

  test("no <module> nodes in output", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const n of data.nodes) {
      expect(n.name).not.toMatch(/^<module/);
    }
  });

  test("edges use symbol_id strings not integers", () => {
    const data = loadGraphData(db, fixtureDir);
    for (const e of data.edges) {
      expect(e.src).toContain("#");
      expect(e.dst).toContain("#");
    }
  });

  test("meta has correct nodeCount and edgeCount", () => {
    const data = loadGraphData(db, fixtureDir);
    expect(data.meta.nodeCount).toBe(data.nodes.length);
    expect(data.meta.edgeCount).toBe(data.edges.length);
  });
});

describe("nexphy visualize", () => {
  const outputPath = join(fixtureDir, "graph.html");

  afterEach(() => {
    try { unlinkSync(outputPath); } catch { /* ok */ }
  });

  test("writes graph.html to project dir by default", async () => {
    await visualizeRun([fixtureDir, "--db", dbPath]);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("graph.html contains embedded nodeCount in JSON meta", async () => {
    await visualizeRun([fixtureDir, "--db", dbPath]);
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain('"nodeCount"');
    expect(html).toContain('"edgeCount"');
  });

  test("graph.html loads D3 from CDN", async () => {
    await visualizeRun([fixtureDir, "--db", dbPath]);
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("d3.v7.min.js");
  });

  test("--output writes to specified path", async () => {
    const customPath = join(fixtureDir, "custom-graph.html");
    try {
      await visualizeRun([fixtureDir, "--db", dbPath, "--output", customPath]);
      expect(existsSync(customPath)).toBe(true);
    } finally {
      try { unlinkSync(customPath); } catch { /* ok */ }
    }
  });
});
```

- [ ] **Step 3: Run the full test suite**

```bash
bun test
```

Expected: 73 existing tests pass + 8 new visualize tests pass = 81 total.

- [ ] **Step 4: Run typecheck and lint**

```bash
bun run typecheck && bunx @biomejs/biome check .
```

Expected: no errors. If Biome flags formatting in `template.ts` (the dense CSS/JS strings), it should pass because they are string literals — Biome does not reformat content inside strings. If Biome flags import order or trailing commas in `visualize.ts`, fix them.

- [ ] **Step 5: Smoke-test the output manually**

```bash
bun run dev -- visualize ./fixtures/simple-ts --open
```

Expected:
1. Terminal prints: `nexphy visualize: .../fixtures/simple-ts/graph.html (N nodes, M edges)`
2. Browser opens `graph.html` showing an Obsidian-style dark force graph
3. Nodes visible, colored by community, sized by PageRank
4. Left sidebar shows search input, edge-kind chips, and "Click a node to see details"
5. Clicking a node highlights it and its neighbors; sidebar shows name, file, PageRank, community, degree

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/integration/visualize.test.ts
git commit -m "feat: wire visualize command + integration tests"
```

---

## Verification checklist

Before claiming done, confirm all of the following:

- [ ] `bun test` — all tests pass (81+ total)
- [ ] `bun run typecheck` — no TypeScript errors
- [ ] `bunx @biomejs/biome check .` — no lint errors
- [ ] `bun run dev -- visualize ./fixtures/simple-ts` — `graph.html` written, no errors
- [ ] Open `graph.html` in browser — graph renders, sidebar works, click-to-focus works, search dims non-matching nodes, edge filter chips toggle edges
