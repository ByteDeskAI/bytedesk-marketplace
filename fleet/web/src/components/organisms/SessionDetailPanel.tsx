// SessionDetailPanel — the right pane of the screenshot's panel 2.
// Composes the meta header (breadcrumb + state + actions) and a tabbed
// content region (Overview / Logs). Phase 4 ships Overview + Logs; later
// phases add Events, Git/PR, Artifacts, Cost, Children, Replay, Audit.

import { useEffect, useState } from 'preact/hooks';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { TerminalView } from './TerminalView';
import type { SessionRow } from '../../api';

const TABS = ['Overview', 'Logs'] as const;
type Tab = typeof TABS[number];

export interface SessionDetailPanelProps {
  ticket: string;
  onClose?: () => void;
}

export function SessionDetailPanel({ ticket, onClose }: SessionDetailPanelProps) {
  const [data, setData] = useState<SessionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');

  useEffect(() => {
    setData(null);
    setError(null);
    const url = `/api/sessions/${encodeURIComponent(ticket)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setData)
      .catch((e) => setError((e as Error).message));
    const id = window.setInterval(() => {
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
        .catch(() => {/* swallow */});
    }, 5000);
    return () => window.clearInterval(id);
  }, [ticket]);

  return (
    <aside class="detail-panel">
      <header class="detail-panel__header">
        <div class="detail-panel__crumbs">
          <span style={{ color: 'var(--color-text-tertiary)' }}>Sessions ›</span>
          <strong>{ticket}</strong>
          {data ? <span style={{ color: 'var(--color-text-secondary)' }}>{data.slug}</span> : null}
          {data ? <Badge state={data.state} /> : null}
        </div>
        <div class="detail-panel__actions">
          <Button onClick={() => alert('Attach lands in Phase 4b (xterm.js).')}>Attach</Button>
          <Button onClick={() => alert('Send Input lands in Phase 5.')}>Send Input</Button>
          <Button onClick={() => alert('More menu lands in Phase 5.')}>More</Button>
          {onClose ? <Button onClick={onClose}>Close</Button> : null}
        </div>
      </header>

      <nav class="detail-panel__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            class={`detail-panel__tab${t === tab ? ' detail-panel__tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <div class="detail-panel__body">
        {error ? (
          <div style={{ color: 'var(--color-state-error)' }}>{error}</div>
        ) : tab === 'Overview' ? (
          <OverviewTab row={data} />
        ) : (
          <TerminalView ticket={ticket} />
        )}
      </div>
    </aside>
  );
}

function OverviewTab({ row }: { row: SessionRow | null }) {
  if (!row) {
    return <div style={{ color: 'var(--color-text-tertiary)' }}>Loading…</div>;
  }
  return (
    <dl class="detail-panel__meta">
      <Field label="Branch" value={<code>{row.branch || '—'}</code>} />
      <Field label="Parent" value={row.parent || '—'} />
      <Field label="Activity" value={row.activity} />
      <Field label="Cost" value={row.cost} />
      <Field label="Runtime" value={row.runtime} />
      <Field label="Progress" value={`${Math.round(row.progress * 100)}%`} />
    </dl>
  );
}

function Field({ label, value }: { label: string; value: preact.ComponentChildren }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
