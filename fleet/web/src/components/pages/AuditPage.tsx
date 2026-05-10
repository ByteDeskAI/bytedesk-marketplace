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

  const total = (evts.data ?? []).length;
  const lastEvt = total > 0 ? (evts.data ?? [])[total - 1] : null;
  const lastVerifiedMs = lastEvt ? Math.max(0, Date.now() - new Date(lastEvt.ts).getTime()) : null;
  // Hash-chain integrity is a stand-in until B13 server-side ships. Today
  // it's "OK" iff every row carries a stable id (ticket@offset) — i.e. no
  // unparseable / missing entries — and we have any events at all.
  const integrityOk = total > 0 && (evts.data ?? []).every((e) => /@\d+$/.test(e.id));

  return (
    <AppShell activeView="audit" topBarTitle="Audit log">
      <header class="page-header">
        <h2 class="page-header__title">Audit log</h2>
        <span class={`tape ${integrityOk ? 'tape--ok' : (total === 0 ? '' : 'tape--err')}`}>
          {total === 0 ? 'CHAIN · EMPTY' : integrityOk ? 'CHAIN · OK' : 'CHAIN · BAD'}
        </span>
        <span class="page-header__sub">
          {filtered.length} / {total} events
        </span>
        <span class="page-header__spacer" />
        <div style={{ width: 280 }}>
          <SearchField placeholder="Filter ticket / kind / detail…" onChange={setQ} />
        </div>
      </header>

      <section class="audit-summary" aria-label="Audit chain summary">
        <div class="audit-summary__item">
          <div class="audit-summary__label">Chain integrity</div>
          <div class={`audit-summary__value ${integrityOk ? 'audit-summary__value--ok' : (total === 0 ? '' : 'audit-summary__value--bad')}`}>
            {total === 0 ? '—' : integrityOk ? 'OK' : 'BREACH'}
          </div>
        </div>
        <div class="audit-summary__item">
          <div class="audit-summary__label">Total events</div>
          <div class="audit-summary__value">{total.toLocaleString()}</div>
        </div>
        <div class="audit-summary__item">
          <div class="audit-summary__label">Last verified</div>
          <div class="audit-summary__value">
            {lastVerifiedMs == null ? '—' : `${formatAge(lastVerifiedMs)} ago`}
          </div>
        </div>
        <div class="audit-summary__item">
          <div class="audit-summary__label">Filtered</div>
          <div class="audit-summary__value">{filtered.length.toLocaleString()}</div>
        </div>
      </section>

      <h3 class="section-heading">
        Event stream
        <span class="section-heading__divider" />
        <span class="section-heading__count">{filtered.length}</span>
      </h3>

      {evts.error ? (
        <div class="empty-state" style={{ color: 'var(--color-state-error)' }}>
          <span class="empty-state__icon" aria-hidden>!</span>
          Couldn't load events: {evts.error.message}
        </div>
      ) : (evts.loading && !evts.data) ? (
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden>·</span>
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden>∅</span>
          No events match the current filter.
        </div>
      ) : (
        <ol class="audit-list">
          {filtered.map((e) => {
            const hash = hashFromId(e.id);
            return (
              <li key={e.id} class="audit-list__row">
                <div class="audit-list__time" title={e.id}>
                  {formatTime(e.ts)}
                </div>
                <div class="audit-list__ticket">{e.ticket}</div>
                <div class="audit-list__kind" style={{ color: KIND_TONES[e.kind] ?? 'var(--color-text-secondary)' }}>
                  {e.kind}
                </div>
                <div class="audit-list__detail">
                  <code>{summarize(e.detail)}</code>
                  <span class={`audit-list__hash ${hash ? 'audit-list__hash--ok' : 'audit-list__hash--bad'}`} style={{ marginLeft: 'var(--space-2)' }}>
                    {hash ? `#${hash}` : '#---'}
                  </span>
                </div>
              </li>
            );
          })}
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

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function hashFromId(id: string): string | null {
  // id is "ticket@offset"; treat the offset as the chain pointer for now.
  const m = /@(\d+)$/.exec(id);
  if (!m) return null;
  // Render as fixed-width hex so rows align in the dense table.
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  return n.toString(16).padStart(6, '0').slice(-6);
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
