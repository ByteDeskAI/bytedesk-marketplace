// TreeView — Phase 12.2 (BDM-28, A2). Parent → child hierarchy derived
// client-side from sessions[].parent. Top-level nodes have no parent or
// have a parent not in the visible set (orphans).

import { useMemo, useState } from 'preact/hooks';
import { Badge } from '../atoms/Badge';
import type { SessionRow } from '../../api';

export interface TreeViewProps {
  rows: SessionRow[];
  onRowClick?: (r: SessionRow) => void;
}

export function TreeView({ rows, onRowClick }: TreeViewProps) {
  const tree = useMemo(() => buildTree(rows), [rows]);
  return (
    <ul class="tree-view">
      {tree.map((n) => <TreeNode key={n.row.ticket} node={n} onRowClick={onRowClick} depth={0} />)}
    </ul>
  );
}

interface Node { row: SessionRow; children: Node[]; }

function buildTree(rows: SessionRow[]): Node[] {
  const byTicket = new Map<string, Node>();
  rows.forEach((r) => byTicket.set(r.ticket, { row: r, children: [] }));
  const roots: Node[] = [];
  byTicket.forEach((n) => {
    const p = n.row.parent && byTicket.get(n.row.parent);
    if (p) p.children.push(n);
    else roots.push(n);
  });
  return roots;
}

function TreeNode({ node, onRowClick, depth }: { node: Node; onRowClick?: (r: SessionRow) => void; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li class="tree-view__node">
      <div class="tree-view__row" onClick={() => onRowClick?.(node.row)} style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <button
          type="button"
          class="tree-view__toggle"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-label={hasChildren ? (open ? 'Collapse' : 'Expand') : ''}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {open ? '▾' : '▸'}
        </button>
        <strong>{node.row.ticket}</strong>
        <span style={{ color: 'var(--color-text-secondary)' }}>{node.row.slug || '—'}</span>
        <Badge state={node.row.state} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          {node.row.activity}
        </span>
      </div>
      {hasChildren && open ? (
        <ul class="tree-view__children">
          {node.children.map((c) => <TreeNode key={c.row.ticket} node={c} onRowClick={onRowClick} depth={depth + 1} />)}
        </ul>
      ) : null}
    </li>
  );
}
