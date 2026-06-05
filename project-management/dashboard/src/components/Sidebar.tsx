import { useState } from 'react';
import Badge from '@atlaskit/badge';
import EditorPanelIcon from '@atlaskit/icon/core/panel-left';
import ListIcon from '@atlaskit/icon/core/list-bulleted';
import DocumentsIcon from '@atlaskit/icon/core/pages';
import RecentIcon from '@atlaskit/icon/core/clock';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import type { ViewId, Doc, Issue } from '../types';

interface Props {
  view: ViewId;
  onView: (v: ViewId) => void;
  keyPrefix: string;
  todoCnt: number;
  doneCnt: number;
  totalIssues: number;
  docs: Doc[];
  activeDocId: string | null;
  onDoc: (id: string) => void;
  docsLoading?: boolean;
}

const NAV_ITEMS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'board',    label: 'Board',    icon: '▣' },
  { id: 'backlog',  label: 'Backlog',  icon: '≡' },
  { id: 'docs',     label: 'Pages',    icon: '📄' },
  { id: 'activity', label: 'Activity', icon: '◉' },
  { id: 'plan',     label: 'Plan',     icon: '💡' },
];

const IconComponents: Record<string, React.ReactNode> = {
  board:    <EditorPanelIcon label="" size="small" />,
  backlog:  <ListIcon label="" size="small" />,
  docs:     <DocumentsIcon label="" size="small" />,
  activity: <RecentIcon label="" size="small" />,
};

const DOC_ICONS: Record<string, string> = {
  wiki: '📄', adr: '⚖', plan: '🗺', learning: '💡', brief: '📋', runbook: '🔧',
};

export default function Sidebar({ view, onView, keyPrefix, todoCnt, doneCnt, totalIssues, docs, activeDocId, onDoc, docsLoading }: Props) {
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set<string>());

  // Build doc tree
  const byParent: Record<string, Doc[]> = {};
  for (const d of docs) {
    const key = d.parent_id ?? '__root__';
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(d);
  }
  const roots = docs.filter(d => !d.parent_id);

  function toggleDoc(id: string) {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function DocItem({ d, depth }: { d: Doc; depth: number }) {
    const ch = byParent[d.id] ?? [];
    const hasChildren = ch.length > 0;
    const isExpanded = expandedDocs.has(d.id);
    const active = activeDocId === d.id;

    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          {/* Expand/collapse toggle — takes up space even when no children to keep alignment */}
          <span
            style={{
              width: 18,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 14 + depth * 14,
              cursor: hasChildren ? 'pointer' : 'default',
              opacity: hasChildren ? 1 : 0,
              color: 'rgba(255,255,255,.5)',
            }}
            onClick={hasChildren ? (e) => { e.stopPropagation(); toggleDoc(d.id); } : undefined}
            aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
          >
            {hasChildren
              ? (isExpanded
                  ? <ChevronDownIcon label="" size="small" />
                  : <ChevronRightIcon label="" size="small" />)
              : null}
          </span>

          <button
            onClick={() => { onDoc(d.id); onView('docs'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 14px 5px 4px',
              flex: 1, textAlign: 'left',
              background: active ? 'rgba(76,154,255,.14)' : 'transparent',
              border: 'none', cursor: 'pointer',
              color: active ? 'var(--ds-link)' : 'rgba(255,255,255,.6)',
              fontSize: 12, borderRadius: 3,
              transition: 'background .1s',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              minWidth: 0,
            }}
            onMouseOver={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.08)'; }}
            onMouseOut={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span style={{ fontSize: 11, flexShrink: 0 }}>{DOC_ICONS[d.doc_type ?? 'wiki'] ?? '📄'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
          </button>
        </div>

        {hasChildren && isExpanded && ch.map(c => <DocItem key={c.id} d={c} depth={depth + 1} />)}
      </>
    );
  }

  function NavItem({ item }: { item: typeof NAV_ITEMS[0] }) {
    const active = view === item.id;
    const count = item.id === 'board' || item.id === 'backlog' ? totalIssues
      : item.id === 'docs' ? docs.length : null;

    return (
      <button
        onClick={() => onView(item.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '7px 16px', width: '100%', textAlign: 'left',
          background: active ? 'rgba(255,255,255,.12)' : 'transparent',
          border: 'none',
          borderLeft: active ? '2px solid var(--ds-background-brand-bold)' : '2px solid transparent',
          cursor: 'pointer',
          color: active ? '#fff' : 'rgba(255,255,255,.7)',
          fontSize: 13, fontWeight: 500,
          transition: 'background .1s',
        }}
        onMouseOver={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.08)'; }}
        onMouseOut={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span style={{ width: 20, display: 'flex', alignItems: 'center', opacity: .85 }}>
          {IconComponents[item.id] ?? <span style={{ fontSize: 14, textAlign: 'center' }}>{item.icon}</span>}
        </span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {count !== null && (
          <Badge appearance="default">{count}</Badge>
        )}
      </button>
    );
  }

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: '#1C2B41',
      borderRight: '1px solid var(--ds-border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Project key chip */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          background: 'var(--ds-background-brand-bold)',
          color: '#fff', borderRadius: 3, padding: '2px 7px',
          fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
          fontFamily: 'monospace',
        }}>
          {keyPrefix || 'PM'}
        </span>
      </div>

      {/* Planning nav */}
      <div style={{ padding: '8px 0 2px', flexShrink: 0 }}>
        <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>
          Planning
        </div>
        {NAV_ITEMS.slice(0, 2).map(item => <NavItem key={item.id} item={item} />)}
        <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '6px 16px' }} />
        <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>
          Knowledge
        </div>
        {NAV_ITEMS.slice(2, 4).map(item => <NavItem key={item.id} item={item} />)}
        <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '6px 16px' }} />
        <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)' }}>
          AI
        </div>
        <NavItem item={{ id: 'plan', label: 'Plan', icon: '💡' }} />
      </div>

      {/* Doc tree */}
      {(docs.length > 0 || docsLoading) && (
        <>
          <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '6px 16px', flexShrink: 0 }} />
          <div style={{ padding: '6px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', flexShrink: 0 }}>
            Pages{docsLoading && <span style={{ fontWeight: 400, textTransform: 'none', opacity: .7 }}> (loading...)</span>}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
            {roots.map(d => <DocItem key={d.id} d={d} depth={0} />)}
          </div>
        </>
      )}

      {/* Bottom stats */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flexShrink: 0 }}>
        {[['To Do', todoCnt], ['Done', doneCnt]].map(([label, val]) => (
          <div key={label as string} style={{
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 3, padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{val}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
