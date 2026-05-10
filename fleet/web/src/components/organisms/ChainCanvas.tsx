// ChainCanvas — Phase 12.4 (BDM-28). Visual flow editor for a chain.
//
// Interactions:
//   - Drag a palette item onto the canvas → create a new node at the
//     drop point.
//   - Drag a node body to move it.
//   - Drag from a node's `out` handle (right side) to another node's
//     `in` handle (left side) → create an edge.
//   - Click a node or edge to select it.
//   - Backspace / Delete on a selected node or edge removes it (and
//     for nodes, drops any incident edges).
//
// Vanilla pointer events — no react-flow / dagre / d3 dependency.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChainNode, ChainEdge, ChainNodeType } from '../../api';
import { PALETTE_ITEMS } from './NodePalette';

// Node default size — kept here so ChainCanvas owns its visual model
// and the inspector / palette don't need to know.
const NODE_W = 168;
const NODE_H = 64;

export type SelectionKind = 'node' | 'edge' | null;
export interface CanvasSelection {
  kind: SelectionKind;
  id?: string;          // node id
  edgeIdx?: number;     // index into edges
}

export interface ChainCanvasProps {
  nodes: ChainNode[];
  edges: ChainEdge[];
  selection: CanvasSelection;
  onChange: (next: { nodes: ChainNode[]; edges: ChainEdge[] }) => void;
  onSelect: (sel: CanvasSelection) => void;
}

interface Drag {
  kind: 'move' | 'edge';
  nodeID: string;
  // For 'move':
  startX?: number;       // pointer client X at drag start
  startY?: number;
  origX?: number;        // node x at drag start
  origY?: number;
  // For 'edge':
  fromID?: string;       // origin node
  pointerX?: number;     // current pointer (canvas-local)
  pointerY?: number;
}

export function ChainCanvas({ nodes, edges, selection, onChange, onSelect }: ChainCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Keyboard delete on the focused canvas.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (selection.kind === 'node' && selection.id) {
        e.preventDefault();
        const id = selection.id;
        onChange({
          nodes: nodes.filter((n) => n.id !== id),
          edges: edges.filter((edge) => edge.from !== id && edge.to !== id),
        });
        onSelect({ kind: null });
      } else if (selection.kind === 'edge' && typeof selection.edgeIdx === 'number') {
        e.preventDefault();
        const idx = selection.edgeIdx;
        onChange({ nodes, edges: edges.filter((_, i) => i !== idx) });
        onSelect({ kind: null });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, edges, selection, onChange, onSelect]);

  // Pointer-move handler (when dragging a node or pulling an edge).
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      if (!drag) return;
      if (drag.kind === 'move' && drag.startX != null && drag.startY != null && drag.origX != null && drag.origY != null) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        const next = nodes.map((n) =>
          n.id === drag.nodeID ? { ...n, x: Math.max(0, drag.origX! + dx), y: Math.max(0, drag.origY! + dy) } : n
        );
        onChange({ nodes: next, edges });
      } else if (drag.kind === 'edge') {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        setDrag({ ...drag, pointerX: e.clientX - rect.left, pointerY: e.clientY - rect.top });
      }
    }
    function onUp(e: PointerEvent) {
      if (drag?.kind === 'edge' && drag.fromID) {
        // If we landed on a node's "in" handle, create the edge.
        const target = e.target as HTMLElement | null;
        const targetNode = target?.closest('[data-node-id]') as HTMLElement | null;
        const targetID = targetNode?.getAttribute('data-node-id');
        if (targetID && targetID !== drag.fromID) {
          const exists = edges.some((edge) => edge.from === drag.fromID && edge.to === targetID);
          if (!exists) {
            onChange({
              nodes,
              edges: [...edges, { from: drag.fromID, to: targetID }],
            });
          }
        }
      }
      setDrag(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, nodes, edges, onChange]);

  // Drag-and-drop from the palette.
  function onCanvasDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/x-fleet-node-type')) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
  }
  function onCanvasDrop(e: DragEvent) {
    const t = e.dataTransfer?.getData('application/x-fleet-node-type') as ChainNodeType | '';
    if (!t) return;
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - NODE_W / 2;
    const y = e.clientY - rect.top - NODE_H / 2;
    const id = freshNodeID(t, nodes);
    const newNode: ChainNode = {
      id,
      type: t,
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      config: defaultConfigFor(t),
    };
    onChange({ nodes: [...nodes, newNode], edges });
    onSelect({ kind: 'node', id });
  }

  function onCanvasClick(e: MouseEvent) {
    if (e.target === canvasRef.current) {
      onSelect({ kind: null });
    }
  }

  // Render edges as inline SVG. Each edge connects (from.right) to
  // (to.left). Selected edge is highlighted.
  const edgeGeometry = edges.map((edge, idx) => {
    const a = nodes.find((n) => n.id === edge.from);
    const b = nodes.find((n) => n.id === edge.to);
    if (!a || !b) return null;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    return { idx, edge, x1, y1, x2, y2 };
  }).filter(Boolean) as { idx: number; edge: ChainEdge; x1: number; y1: number; x2: number; y2: number }[];

  return (
    <div
      ref={canvasRef}
      class="chain-canvas"
      tabIndex={0}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onClick={onCanvasClick}
      role="application"
      aria-label="Chain canvas"
    >
      <svg class="chain-canvas__svg" aria-hidden="true">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edgeGeometry.map(({ idx, edge, x1, y1, x2, y2 }) => {
          const isSelected = selection.kind === 'edge' && selection.edgeIdx === idx;
          const cls = `chain-edge${isSelected ? ' chain-edge--selected' : ''}${edge.on_success ? ' chain-edge--success' : ''}${edge.on_failure ? ' chain-edge--failure' : ''}`;
          // Curve: cubic bezier with horizontal control points so edges
          // bend nicely between left-to-right placed nodes.
          const dx = Math.max(40, Math.abs(x2 - x1) / 2);
          const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          return (
            <g key={idx} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'edge', edgeIdx: idx }); }}>
              {/* Wide invisible hit target for easier clicking. */}
              <path d={d} stroke="transparent" stroke-width="14" fill="none" style={{ cursor: 'pointer' }} />
              <path d={d} class={cls} fill="none" marker-end="url(#arrow)" />
            </g>
          );
        })}
        {drag?.kind === 'edge' && drag.fromID && drag.pointerX != null && drag.pointerY != null ? (
          (() => {
            const a = nodes.find((n) => n.id === drag.fromID);
            if (!a) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = drag.pointerX;
            const y2 = drag.pointerY;
            const dx = Math.max(40, Math.abs(x2 - x1) / 2);
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            return <path d={d} class="chain-edge chain-edge--ghost" fill="none" />;
          })()
        ) : null}
      </svg>

      {nodes.map((n) => {
        const isSelected = selection.kind === 'node' && selection.id === n.id;
        const palette = PALETTE_ITEMS.find((p) => p.type === n.type);
        return (
          <div
            key={n.id}
            data-node-id={n.id}
            class={`chain-node chain-node--${n.type}${isSelected ? ' chain-node--selected' : ''}`}
            style={{ left: `${n.x}px`, top: `${n.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }}
            onPointerDown={(e) => {
              // Don't initiate move when grabbing the out-handle.
              const cls = (e.target as HTMLElement).className;
              if (typeof cls === 'string' && cls.includes('chain-node__handle')) return;
              e.stopPropagation();
              onSelect({ kind: 'node', id: n.id });
              setDrag({
                kind: 'move',
                nodeID: n.id,
                startX: e.clientX,
                startY: e.clientY,
                origX: n.x,
                origY: n.y,
              });
            }}
          >
            <div class="chain-node__icon" aria-hidden="true">{palette?.icon ?? '·'}</div>
            <div class="chain-node__body">
              <div class="chain-node__type">{palette?.label ?? n.type}</div>
              <div class="chain-node__id">{n.id}</div>
            </div>
            {/* in/out handles */}
            <span class="chain-node__handle chain-node__handle--in" aria-hidden="true" />
            <span
              class="chain-node__handle chain-node__handle--out"
              aria-label="Drag to connect"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                setDrag({
                  kind: 'edge',
                  nodeID: n.id,
                  fromID: n.id,
                  pointerX: e.clientX - rect.left,
                  pointerY: e.clientY - rect.top,
                });
              }}
            />
          </div>
        );
      })}

      {nodes.length === 0 ? (
        <div class="chain-canvas__empty">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
            &gt; CANVAS EMPTY
          </div>
          <div style={{ marginTop: 'var(--space-2)' }}>
            Drag a node from the left to get started, or click a palette entry to add at canvas center.
          </div>
        </div>
      ) : null}
    </div>
  );
}

// freshNodeID picks a unique id like "spawn-1", "spawn-2". Authors can
// rename via the inspector if they want.
export function freshNodeID(type: ChainNodeType, existing: ChainNode[]): string {
  let i = 1;
  while (existing.some((n) => n.id === `${type}-${i}`)) i++;
  return `${type}-${i}`;
}

// defaultConfigFor returns a starter config for a fresh node of the
// given type. Matches the field set the inspector renders.
export function defaultConfigFor(type: ChainNodeType): Record<string, unknown> {
  switch (type) {
    case 'spawn':
      return { ticket: '', slug: '', prompt: '', full_auto: true };
    case 'wait':
      return { ticket: '', state: 'done', timeout: 600 };
    case 'judge':
      return { prompt: '' };
    case 'condition':
      return { expr: '' };
    case 'notify':
      return { message: '' };
    case 'script':
      return { cmd: '', description: '' };
    default:
      return {};
  }
}
