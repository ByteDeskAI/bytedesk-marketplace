import { useState, useEffect, useRef, useCallback } from 'react';
import type { Issue, ViewId } from '../types';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: string;
  action: () => void;
}

interface Props {
  issues: Issue[];
  onIssueClick: (issue: Issue) => void;
  onView: (view: ViewId) => void;
  onCreateIssue: () => void;
}

export default function CommandPalette({ issues, onIssueClick, onView, onCreateIssue }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setQuery('');
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);

  const viewCommands: Command[] = [
    { id: 'view-board', label: 'Go to Board', icon: '⬜', description: 'Kanban board view', action: () => { onView('board'); close(); } },
    { id: 'view-backlog', label: 'Go to Backlog', icon: '≡', description: 'Full issue list', action: () => { onView('backlog'); close(); } },
    { id: 'view-plan', label: 'Go to Plan', icon: '🗺', description: 'Planning sessions', action: () => { onView('plan'); close(); } },
    { id: 'view-activity', label: 'Go to Activity', icon: '⚡', description: 'Activity log', action: () => { onView('activity'); close(); } },
    { id: 'create', label: 'Create Issue', icon: '+', description: 'Open create dialog', action: () => { onCreateIssue(); close(); } },
  ];

  const q = query.trim().toLowerCase();

  const matchedViews = q
    ? viewCommands.filter(c => c.label.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
    : viewCommands;

  const matchedIssues = q
    ? issues.filter(i =>
        i.id.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q)
      ).slice(0, 8)
    : [];

  const total = matchedViews.length + matchedIssues.length;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 800,
          background: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-label="Command palette"
        style={{
          position: 'fixed',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 801,
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--ds-surface-overlay)',
          border: '1px solid var(--ds-border-bold)',
          borderRadius: 12,
          boxShadow: 'var(--ds-shadow-overlay)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--ds-border)',
        }}>
          <span style={{ color: 'var(--ds-text-subtlest)', fontSize: 18 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search issues, views, or actions…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ds-text)',
              fontSize: 15,
              fontFamily: 'inherit',
            }}
            onKeyDown={e => { if (e.key === 'Escape') close(); }}
          />
          <kbd style={{
            background: 'var(--ds-surface-sunken)',
            border: '1px solid var(--ds-border)',
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 11,
            color: 'var(--ds-text-subtlest)',
          }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {total === 0 && q && (
            <div style={{ padding: '20px 16px', color: 'var(--ds-text-subtlest)', fontSize: 13, textAlign: 'center' }}>
              No results for "{query}"
            </div>
          )}

          {matchedViews.length > 0 && (
            <section>
              <div style={{ padding: '8px 16px 4px', fontSize: 11, color: 'var(--ds-text-subtlest)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Actions
              </div>
              {matchedViews.map(cmd => (
                <button
                  key={cmd.id}
                  onClick={cmd.action}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '10px 16px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--ds-text)', textAlign: 'left',
                    fontFamily: 'inherit',
                    lineHeight: 'inherit',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--ds-background-neutral-hovered)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{cmd.icon}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{cmd.label}</span>
                    {cmd.description && (
                      <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)', marginLeft: 8 }}>{cmd.description}</span>
                    )}
                  </span>
                </button>
              ))}
            </section>
          )}

          {matchedIssues.length > 0 && (
            <section>
              <div style={{ padding: '8px 16px 4px', fontSize: 11, color: 'var(--ds-text-subtlest)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Issues
              </div>
              {matchedIssues.map(issue => (
                <button
                  key={issue.id}
                  onClick={() => { onIssueClick(issue); close(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '10px 16px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--ds-text)', textAlign: 'left',
                    fontFamily: 'inherit',
                    lineHeight: 'inherit',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--ds-background-neutral-hovered)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
                    color: 'var(--ds-link)', flexShrink: 0, minWidth: 56,
                  }}>{issue.id}</span>
                  <span style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {issue.title}
                  </span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px',
                    background: 'var(--ds-surface-sunken)',
                    borderRadius: 4, color: 'var(--ds-text-subtlest)', flexShrink: 0,
                  }}>{issue.status}</span>
                </button>
              ))}
            </section>
          )}

          {!q && (
            <div style={{ padding: '8px 16px 12px', fontSize: 11, color: 'var(--ds-text-subtlest)', textAlign: 'center' }}>
              Type to search issues · <kbd style={{ background: 'var(--ds-surface-sunken)', padding: '0 4px', borderRadius: 3 }}>↑↓</kbd> to navigate · <kbd style={{ background: 'var(--ds-surface-sunken)', padding: '0 4px', borderRadius: 3 }}>Enter</kbd> to select
            </div>
          )}
        </div>
      </div>
    </>
  );
}
