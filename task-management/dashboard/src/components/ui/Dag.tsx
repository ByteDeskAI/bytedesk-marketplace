import { useMemo, useState } from "react";
import type { GraphEdge, GraphNode } from "../../lib/types";

/**
 * A layered dependency graph in SVG. Longest-path layering (a blocker sits left of what it
 * blocks), rows by insertion order within a layer, straight edges with a cubic in the middle.
 * ponytail: no dagre; a board has tens of edges, not thousands. Add crossing reduction when a
 * graph reads as a hairball.
 */
export function Dag({ nodes, edges, onSelect, selected, cycles = [] }: { nodes: GraphNode[]; edges: GraphEdge[]; onSelect?: (id: string) => void; selected?: string | null; cycles?: string[][] }) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => place(nodes, edges), [nodes, edges]);
  const inCycle = new Set(cycles.flat());
  const W = 168, H = 44, GX = 64, GY = 14;
  const width = (layout.cols + 1) * (W + GX);
  const height = (layout.rows + 1) * (H + GY);
  const pos = (id: string) => {
    const p = layout.at.get(id)!;
    return { x: p.col * (W + GX) + GX / 2, y: p.row * (H + GY) + GY / 2 };
  };
  const related = (id: string) => edges.some((e) => (e.from === id || e.to === id) && (e.from === hover || e.to === hover));
  return (
    <svg className="tm-chart" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`dependency graph, ${nodes.length} tasks, ${edges.length} edges`} style={{ width, height, maxWidth: "none" }}>
      <defs>
        <marker id="tm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" style={{ fill: "var(--tm-line-strong)" }} />
        </marker>
      </defs>
      {edges.map((e, i) => {
        if (!layout.at.has(e.from) || !layout.at.has(e.to)) return null;
        const a = pos(e.from), b = pos(e.to);
        const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
        const mx = (x1 + x2) / 2;
        const lit = hover === e.from || hover === e.to;
        return (
          <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" markerEnd="url(#tm-arrow)"
            style={{ stroke: lit ? "var(--tm-accent)" : "var(--tm-line-strong)", strokeWidth: lit ? 2 : 1.5, strokeDasharray: e.type === "subtask" ? "4 3" : undefined, opacity: hover && !lit ? 0.35 : 1 }} />
        );
      })}
      {nodes.map((n) => {
        if (!layout.at.has(n.id)) return null;
        const { x, y } = pos(n.id);
        const dim = hover && hover !== n.id && !related(n.id);
        return (
          <g key={n.id} transform={`translate(${x},${y})`} style={{ cursor: onSelect ? "pointer" : undefined, opacity: dim ? 0.45 : 1 }}
            onClick={() => onSelect?.(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} tabIndex={onSelect ? 0 : -1} role={onSelect ? "button" : undefined}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(n.id); }} aria-label={`${n.id} ${n.title ?? ""} ${n.status ?? ""}`}>
            <rect width={W} height={H} rx={8} style={{ fill: "var(--tm-surface)", stroke: selected === n.id ? "var(--tm-accent)" : inCycle.has(n.id) ? "var(--tm-bad)" : "var(--tm-line)", strokeWidth: selected === n.id || inCycle.has(n.id) ? 2 : 1 }} />
            <circle cx={14} cy={H / 2} r={4} style={{ fill: `var(--tm-status-${n.status ?? "open"})` }} />
            <text x={26} y={18} style={{ fill: "var(--tm-ink-2)" }}>{n.id}</text>
            <text x={26} y={33} style={{ fill: "var(--tm-ink)", fontFamily: "var(--tm-font)", fontSize: 11 }}>{clip(n.title ?? "", 24)}</text>
          </g>
        );
      })}
    </svg>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function place(nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const preds = new Map<string, string[]>();
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (col.has(id)) return col.get(id)!;
    if (visiting.has(id)) return 0; // a cycle: break it here, doctor reports it
    visiting.add(id);
    const d = Math.max(-1, ...(preds.get(id) ?? []).map(depth)) + 1;
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  const rowsIn = new Map<number, number>();
  const at = new Map<string, { col: number; row: number }>();
  let cols = 0, rows = 0;
  for (const n of nodes) {
    const c = depth(n.id);
    const r = rowsIn.get(c) ?? 0;
    rowsIn.set(c, r + 1);
    at.set(n.id, { col: c, row: r });
    cols = Math.max(cols, c);
    rows = Math.max(rows, r);
  }
  return { at, cols, rows };
}
