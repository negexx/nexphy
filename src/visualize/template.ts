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
  const dataJson = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");
  const edgeKinds = [...new Set(data.edges.map((e) => e.kind))].sort();
  const filterChips = edgeKinds
    .map((kind) => {
      const color = EDGE_COLORS[kind] ?? "#888";
      return `<button class="chip active" data-kind="${kind}" style="--chip-color:${color}">${kind}</button>`;
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
  function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  var COMMUNITY_COLORS=${JSON.stringify(COMMUNITY_COLORS)};
  var EDGE_COLORS=${JSON.stringify(EDGE_COLORS)};
  var nodes=GRAPH_DATA.nodes.map(function(d){return Object.assign({},d);});
  var edges=GRAPH_DATA.edges.map(function(d){return Object.assign({},d);});
  var nodeById=new Map(nodes.map(function(n){return [n.id,n];}));
  var links=edges
    .filter(function(e){return nodeById.has(e.src)&&nodeById.has(e.dst);})
    .map(function(e){return {source:nodeById.get(e.src),target:nodeById.get(e.dst),kind:e.kind};});
  var maxPR=nodes.reduce(function(m,n){return Math.max(m,n.pagerank);},0.001);
  function nodeRadius(d){return 4+14*Math.log1p(d.pagerank)/Math.log1p(maxPR);}
  function nodeColor(d){return COMMUNITY_COLORS[((d.community%COMMUNITY_COLORS.length)+COMMUNITY_COLORS.length)%COMMUNITY_COLORS.length];}
  var sorted=nodes.slice().sort(function(a,b){return b.pagerank-a.pagerank;});
  var topN=Math.max(1,Math.floor(nodes.length*0.2));
  var prThreshold=sorted[topN-1]?sorted[topN-1].pagerank:0;
  var svg=d3.select('#graph');
  function W(){return svg.node().clientWidth;}
  function H(){return svg.node().clientHeight;}
  var g=svg.append('g');
  var zoom=d3.zoom().scaleExtent([0.1,8]).on('zoom',function(e){g.attr('transform',e.transform);});
  svg.call(zoom);
  svg.on('click',function(event){
    if(event.target===svg.node()||event.target.tagName==='svg')clearFocus();
  });
  var defs=svg.append('defs');
  var kinds=[...new Set(links.map(function(l){return l.kind;}))];
  kinds.forEach(function(kind){
    var color=EDGE_COLORS[kind]||'#888';
    defs.append('marker')
      .attr('id','arrow-'+kind)
      .attr('viewBox','0 -4 8 8').attr('refX',8).attr('refY',0)
      .attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto')
      .append('path').attr('d','M0,-4L8,0L0,4').attr('fill',color).attr('opacity',0.7);
  });
  var link=g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke',function(d){return EDGE_COLORS[d.kind]||'#888';})
    .attr('stroke-opacity',0.4)
    .attr('stroke-width',function(d){return d.kind==='imports'?1.5:1;})
    .attr('marker-end',function(d){return 'url(#arrow-'+d.kind+')';});
  var node=g.append('g').selectAll('g').data(nodes).join('g').attr('class','node')
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
  var simulation=d3.forceSimulation(nodes)
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
      '<div class="info-name">'+escapeHtml(d.name)+'</div>'+
      '<div class="info-file">'+escapeHtml(d.file)+':'+d.line+'</div>'+
      '<span class="info-badge">'+escapeHtml(d.kind)+'</span>'+
      '<div class="info-row"><span class="info-key">PageRank</span><span class="info-val">'+d.pagerank.toFixed(4)+'</span></div>'+
      '<div class="info-row"><span class="info-key">Community</span><span class="info-val">'+d.community+'</span></div>'+
      '<div class="info-row"><span class="info-key">Edges</span><span class="info-val">'+degree+'</span></div>';
  }
  var tooltip=document.getElementById('tooltip');
  function showTooltip(event,d){
    tooltip.innerHTML='<div class="t-name">'+escapeHtml(d.name)+'</div><div class="t-file">'+escapeHtml(d.file)+':'+d.line+'</div><div class="t-kind">'+escapeHtml(d.kind)+'</div>';
    tooltip.style.display='block';
    tooltip.style.left=(event.clientX+14)+'px';
    tooltip.style.top=(event.clientY-10)+'px';
  }
  function hideTooltip(){tooltip.style.display='none';}
  window.onSearch=function(val){searchTerm=val.trim().toLowerCase();applyFilters();};
  document.getElementById('filters').addEventListener('click',function(event){
    var btn=event.target;
    if(!btn.classList.contains('chip'))return;
    var kind=btn.dataset.kind;
    if(activeKinds.has(kind)){activeKinds.delete(kind);btn.classList.remove('active');}
    else{activeKinds.add(kind);btn.classList.add('active');}
    applyFilters();
  });
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
