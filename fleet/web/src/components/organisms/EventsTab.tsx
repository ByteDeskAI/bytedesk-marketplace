// EventsTab — Phase 12.2 (BDM-28, A10). Per-session events feed.
// Reuses /api/events?ticket=…

import { useEffect, useState } from 'preact/hooks';
import type { FleetEvent } from '../../api';

export function EventsTab({ ticket }: { ticket: string }) {
  const [data, setData] = useState<FleetEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    const load = () =>
      fetch(`/api/events?limit=200`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
        .then((all: FleetEvent[]) => setData(all.filter((e) => e.ticket === ticket)))
        .catch((e) => setErr((e as Error).message));
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [ticket]);

  if (err) return <div style={{ color: 'var(--color-state-error)' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--color-text-tertiary)' }}>Loading events…</div>;
  if (data.length === 0) return <div style={{ color: 'var(--color-text-tertiary)' }}>No events yet for {ticket}.</div>;

  return (
    <ul class="audit-list" style={{ borderRadius: 'var(--radius-md)' }}>
      {data.map((e) => (
        <li key={e.id} class="audit-list__row">
          <div class="audit-list__time">{new Date(e.ts).toLocaleString()}</div>
          <div class="audit-list__ticket">{e.ticket}</div>
          <div class="audit-list__kind">{e.kind}</div>
          <div class="audit-list__detail">
            <code style={{ fontSize: 'var(--text-xs)' }}>{summarize(e.detail)}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}

function summarize(detail: Record<string, unknown>): string {
  const keys = Object.keys(detail);
  if (keys.length === 0) return '';
  return keys.slice(0, 4).map((k) => {
    const v = detail[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}=${s.length > 60 ? s.slice(0, 57) + '…' : s}`;
  }).join(' · ');
}
