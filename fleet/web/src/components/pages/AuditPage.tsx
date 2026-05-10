// AuditPage — Phase 9 (BDM-25, B13). Tamper-evident audit log viewer.
// Shows the merged JSONL events feed as an immutable, time-ordered
// list. Each row's `id` is "ticket@offset", so the same line always
// hashes to the same id (proxy for tamper-evidence today; a real
// hash-chain lands when B13 server-side gets there).

import { useMemo, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { useEventStream } from '../../hooks/useEventStream';
import { SearchField } from '../molecules/SearchField';

const KIND_TONES: Record<string, string> = {
  pr_opened: 'var(--color-state-working)',
  merge: 'var(--color-state-done)',
  review_comment: 'var(--color-state-reviewing)',
  review_summary: 'var(--color-state-reviewing)',
  commit_pushed: 'var(--color-text-secondary)',
};

export function AuditPage() {
  const evts = useEventStream();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const list = evts.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) =>
      e.ticket.toLowerCase().includes(needle) ||
      e.kind.toLowerCase().includes(needle) ||
      JSON.stringify(e.detail).toLowerCase().includes(needle),
    );
  }, [evts.data, q]);

  return (
    <AppShell activeView="audit" topBarTitle="Audit log">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>Audit log</h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          {filtered.length} / {(evts.data ?? []).length}
        </span>
        <div style={{ width: 280 }}>
          <SearchField placeholder="Filter ticket / kind / detail…" onChange={setQ} />
        </div>
      </div>

      {evts.error ? (
        <div style={{ color: 'var(--color-state-error)' }}>Couldn't load events: {evts.error.message}</div>
      ) : (evts.loading && !evts.data) ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>
          No events match the current filter. Audit feed is sourced from the per-session events JSONL files.
        </div>
      ) : (
        <ol class="audit-list">
          {filtered.map((e) => (
            <li key={e.id} class="audit-list__row">
              <div class="audit-list__time" title={e.id}>
                {formatTime(e.ts)}
              </div>
              <div class="audit-list__ticket">{e.ticket}</div>
              <div class="audit-list__kind" style={{ color: KIND_TONES[e.kind] ?? 'var(--color-text-secondary)' }}>
                {e.kind}
              </div>
              <div class="audit-list__detail">
                <code style={{ fontSize: 'var(--text-xs)' }}>{summarize(e.detail)}</code>
              </div>
            </li>
          ))}
        </ol>
      )}
    </AppShell>
  );
}

function formatTime(ts: string | Date) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function summarize(detail: Record<string, unknown>): string {
  const keys = Object.keys(detail);
  if (keys.length === 0) return '';
  const parts = keys.slice(0, 4).map((k) => {
    const v = detail[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    const trim = s.length > 60 ? s.slice(0, 57) + '…' : s;
    return `${k}=${trim}`;
  });
  return parts.join(' · ');
}
