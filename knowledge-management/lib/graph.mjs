/**
 * Link graph + backlinks from concept markdown bodies.
 */
import { listConcepts, pathForConceptId } from "./store.mjs";
import { existsSync } from "node:fs";
import { paths } from "./paths.mjs";

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

export function extractLinks(body, fromId) {
  const links = [];
  if (!body) return links;
  let m;
  const re = new RegExp(LINK_RE.source, "g");
  while ((m = re.exec(body))) {
    const href = m[2].split("#")[0].split("?")[0];
    if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
      continue;
    }
    let target = href;
    if (target.startsWith("/")) {
      target = target.slice(1);
    } else {
      // relative to fromId directory
      const baseDir = fromId.includes("/") ? fromId.split("/").slice(0, -1) : [];
      const parts = [...baseDir, ...target.split("/")];
      const resolved = [];
      for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part === "..") resolved.pop();
        else resolved.push(part);
      }
      target = resolved.join("/");
    }
    target = target.replace(/\.md$/, "");
    links.push({ label: m[1], target, raw: href });
  }
  return links;
}

export function graphData(p = paths()) {
  const concepts = listConcepts(p);
  const nodes = concepts.map((c) => ({ id: c.id, title: c.title, type: c.type }));
  const edges = [];
  const ids = new Set(concepts.map((c) => c.id));
  for (const c of concepts) {
    for (const link of extractLinks(c.body, c.id)) {
      edges.push({ from: c.id, to: link.target, label: link.label, broken: !ids.has(link.target) });
    }
  }
  return { nodes, edges };
}

export function backlinks(id, p = paths()) {
  const clean = String(id).replace(/^\/+/, "").replace(/\.md$/, "");
  const hits = [];
  for (const c of listConcepts(p)) {
    for (const link of extractLinks(c.body, c.id)) {
      if (link.target === clean) hits.push({ from: c.id, title: c.title, label: link.label });
    }
  }
  return hits;
}

export function mermaid(p = paths()) {
  const { nodes, edges } = graphData(p);
  const lines = ["flowchart LR"];
  for (const n of nodes) {
    const label = (n.title || n.id).replace(/"/g, "'");
    lines.push(`  ${JSON.stringify(n.id)}["${label}"]`);
  }
  for (const e of edges) {
    if (e.broken) continue;
    lines.push(`  ${JSON.stringify(e.from)} --> ${JSON.stringify(e.to)}`);
  }
  return lines.join("\n");
}

export function brokenLinks(p = paths()) {
  return graphData(p).edges.filter((e) => e.broken);
}
