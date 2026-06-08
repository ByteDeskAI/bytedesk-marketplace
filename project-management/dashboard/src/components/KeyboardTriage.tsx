import { useState, useEffect, useCallback } from 'react';
import Lozenge from '@atlaskit/lozenge';
import Button from '@atlaskit/button';
import type { Issue } from '../types';

interface Props {
  issues: Issue[];  // backlog issues to triage
  onClose: () => void;
  onRefresh: () => void;
}

// Status appearance mapping
const STATUS_APP: Record<string, 'default' | 'inprogress' | 'moved' | 'success' | 'removed'> = {
  TODO: 'default', IN_PROGRESS: 'inprogress', REVIEW: 'moved', DONE: 'success', DRAFT: 'default', NEEDS_INPUT: 'removed',
};

export default function KeyboardTriage({ issues, onClose, onRefresh }: Props) {
  const [idx, setIdx] = useState(0);
  const [acting, setActing] = useState(false);

  const current = issues[idx] ?? null;

  const act = useCallback(async (action: string) => {
    if (!current || acting) return;
    setActing(true);
    try {
      if (action === 'approve') {
        await fetch(`/api/issues/${current.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'TODO' }),
        });
      } else if (action === 'defer') {
        await fetch(`/api/issues/${current.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sprint_id: null }),
        });
      } else if (action === 'pin') {
        // Use PUT endpoint which accepts pinned in allowed_keys
        await fetch(`/api/issues/${current.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: !current.pinned }),
        });
      }
      onRefresh();
      setIdx(i => Math.min(i + 1, issues.length - 1));
    } catch {
      // silently ignore network errors
    }
    setActing(false);
  }, [current, acting, onRefresh, issues.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'j') setIdx(i => Math.min(i + 1, issues.length - 1));
      if (e.key === 'ArrowLeft' || e.key === 'h' || e.key === 'k') setIdx(i => Math.max(i - 1, 0));
      if (e.key === 'a') act('approve');
      if (e.key === 'd') act('defer');
      if (e.key === 'p') act('pin');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [act, issues.length, onClose]);

  if (!current) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--ds-surface-overlay)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--ds-text)' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Triage complete</div>
        <div style={{ marginTop: 16 }}><Button onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );

  const pct = Math.round((idx / Math.max(issues.length, 1)) * 100);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 900, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Progress bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--ds-surface-sunken)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--ds-background-brand-bold)', transition: 'width 0.2s' }} />
      </div>

      {/* Counter */}
      <div style={{ position: 'absolute', top: 16, right: 24, color: 'var(--ds-text-subtlest)', fontSize: 13 }}>
        {idx + 1} / {issues.length} · <kbd style={{ background: 'var(--ds-surface-sunken)', padding: '0 4px', borderRadius: 3 }}>Esc</kbd> to exit
      </div>

      {/* Card */}
      <div style={{ width: 600, maxWidth: 'calc(100vw - 40px)', background: 'var(--ds-surface-overlay)', borderRadius: 12, padding: 32, boxShadow: 'var(--ds-shadow-overlay)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--ds-link)', fontWeight: 600 }}>{current.id}</span>
          <Lozenge appearance={STATUS_APP[current.status] ?? 'default'}>{current.status}</Lozenge>
          {current.pinned && <span style={{ fontSize: 13 }}>📌</span>}
          {(current.reopen_count ?? 0) > 0 && <span style={{ fontSize: 11, color: 'var(--ds-text-warning)' }}>↩ {current.reopen_count}×</span>}
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)', marginBottom: 12, lineHeight: 1.3 }}>{current.title}</div>

        {current.description && (
          <div style={{ fontSize: 14, color: 'var(--ds-text-subtle)', marginBottom: 16, maxHeight: 120, overflow: 'hidden', lineHeight: 1.6 }}>
            {current.description.slice(0, 300)}{current.description.length > 300 ? '…' : ''}
          </div>
        )}

        {current.acceptance_criteria?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acceptance criteria</div>
            {current.acceptance_criteria.slice(0, 3).map((c, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--ds-text-subtle)', paddingLeft: 12, borderLeft: '2px solid var(--ds-border)', marginBottom: 4 }}>{c}</div>
            ))}
            {current.acceptance_criteria.length > 3 && <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)' }}>+{current.acceptance_criteria.length - 3} more</div>}
          </div>
        )}

        {/* Tags */}
        {(current.tags ?? []).length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {(current.tags ?? []).slice(0, 4).map(tag => (
              <span key={tag} style={{
                fontSize: 10, padding: '1px 5px',
                background: 'var(--ds-surface-sunken)',
                borderRadius: 3, color: 'var(--ds-text-subtlest)',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Button appearance="primary" onClick={() => act('approve')} isDisabled={acting}>
            <kbd style={{ background: 'rgba(255,255,255,0.2)', padding: '0 4px', borderRadius: 3, fontSize: 11, marginRight: 6 }}>A</kbd>
            Approve → TODO
          </Button>
          <Button appearance="subtle" onClick={() => act('defer')} isDisabled={acting}>
            <kbd style={{ background: 'var(--ds-surface-sunken)', padding: '0 4px', borderRadius: 3, fontSize: 11, marginRight: 6 }}>D</kbd>
            Defer
          </Button>
          <Button appearance="subtle" onClick={() => act('pin')} isDisabled={acting}>
            <kbd style={{ background: 'var(--ds-surface-sunken)', padding: '0 4px', borderRadius: 3, fontSize: 11, marginRight: 6 }}>P</kbd>
            {current.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button appearance="subtle" onClick={() => setIdx(i => Math.max(i-1,0))} isDisabled={idx === 0}>← Prev</Button>
            <Button appearance="subtle" onClick={() => setIdx(i => Math.min(i+1, issues.length-1))} isDisabled={idx >= issues.length-1}>Next →</Button>
          </div>
        </div>
      </div>

      {/* Keyboard hint */}
      <div style={{ marginTop: 20, fontSize: 12, color: 'rgba(255,255,255,0.5)', display: 'flex', gap: 20 }}>
        <span><kbd>A</kbd> approve</span>
        <span><kbd>D</kbd> defer</span>
        <span><kbd>P</kbd> pin/unpin</span>
        <span><kbd>← →</kbd> navigate</span>
        <span><kbd>Esc</kbd> exit</span>
      </div>
    </div>
  );
}
