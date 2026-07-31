/**
 * Export a self-contained HTML graph for a knowledge bundle (PR7).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { graphData, mermaid } from "./graph.mjs";
import { listConcepts } from "./store.mjs";
import { trustTier } from "./validate.mjs";
import { paths } from "./paths.mjs";

export function renderVizHtml(p = paths()) {
  const { nodes, edges } = graphData(p);
  const concepts = listConcepts(p).map((c) => ({
    id: c.id,
    title: c.title,
    type: c.type,
    description: c.description,
    trust: trustTier(c.data),
  }));
  const data = JSON.stringify({ nodes, edges, concepts }, null, 0);
  const mmd = mermaid(p);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Knowledge graph</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #0f1419; color: #e7ecf1; }
  header { padding: 1rem 1.5rem; border-bottom: 1px solid #243044; }
  h1 { margin: 0; font-size: 1.1rem; }
  main { display: grid; grid-template-columns: 1fr 320px; min-height: calc(100vh - 56px); }
  #graph { padding: 1rem; overflow: auto; white-space: pre; font-family: ui-monospace, monospace; font-size: 12px; }
  aside { border-left: 1px solid #243044; padding: 1rem; overflow: auto; }
  .card { background: #1a2332; border-radius: 8px; padding: 0.75rem; margin-bottom: 0.5rem; }
  .type { color: #7dd3fc; font-size: 0.75rem; }
  .trust { color: #86efac; font-size: 0.75rem; }
</style>
</head>
<body>
<header><h1>OKF knowledge graph · ${nodes.length} concepts · ${edges.length} links</h1></header>
<main>
  <pre id="graph">${escapeHtml(mmd)}</pre>
  <aside id="list"></aside>
</main>
<script>
const DATA = ${data};
const list = document.getElementById('list');
for (const c of DATA.concepts) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = '<div class="type">' + c.type + '</div><strong>' + c.title + '</strong>' +
    '<div class="trust">' + c.trust + '</div><div style="opacity:.8;font-size:12px;margin-top:4px">' +
    (c.description || '') + '</div><div style="opacity:.5;font-size:11px">' + c.id + '</div>';
  list.appendChild(el);
}
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function writeViz(outPath, p = paths()) {
  const html = renderVizHtml(p);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  return outPath;
}
