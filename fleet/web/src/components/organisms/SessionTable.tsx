import { useMemo, useState } from 'preact/hooks';
import { Badge } from '../atoms/Badge';
import { SearchField } from '../molecules/SearchField';
import type { SessionRow, SessionState } from '../../api';

export interface SessionTableProps {
  rows: SessionRow[];
  loading?: boolean;
  density?: 'comfortable' | 'compact';
  onRowClick?: (row: SessionRow) => void;
}

const STATE_FILTERS: { id: 'all' | 'active' | 'needs-input' | 'done'; label: string; match: (s: SessionState) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'active', label: 'Active', match: (s) => s === 'starting' || s === 'working' || s === 'reviewing' },
  { id: 'needs-input', label: 'Needs Input', match: (s) => s === 'needs-input' || s === 'blocked' || s === 'error' },
  { id: 'done', label: 'Done', match: (s) => s === 'done' || s === 'completed' || s === 'idle' },
];

export function SessionTable({ rows, loading, density = 'comfortable', onRowClick }: SessionTableProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATE_FILTERS[number]['id']>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sf = STATE_FILTERS.find((f) => f.id === filter)!;
    return rows.filter((r) => {
      if (!sf.match(r.state)) return false;
      if (!q) return true;
      return (
        r.ticket.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.branch || '').toLowerCase().includes(q) ||
        (r.parent || '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  return (
    <div>
      <header class="page-header" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 class="page-header__title">&gt; SESSIONS</h2>
        <span class="page-header__sub">{filtered.length} / {rows.length} rows</span>
        <div class="filter-chips" role="group" aria-label="State filter">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              class={`filter-chip${f.id === filter ? ' filter-chip--active' : ''}`}
              aria-pressed={f.id === filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span class="page-header__spacer" />
        <div style={{ width: 240 }}>
          <SearchField placeholder="Filter ticket, slug, branch…" onChange={setQuery} />
        </div>
      </header>
      <div
        class={`session-table${density === 'compact' ? ' session-table--compact' : ''}`}
        role="table"
        aria-label="Sessions"
      >
        <div class="session-table__header" role="row">
          <div role="columnheader">Ticket</div>
          <div role="columnheader">Session</div>
          <div role="columnheader">State</div>
          <div role="columnheader">Parent</div>
          <div role="columnheader">Branch</div>
          <div role="columnheader">Activity</div>
          <div role="columnheader">Cost</div>
          <div role="columnheader">Runtime</div>
          <div role="columnheader">Progress</div>
        </div>

        {loading && rows.length === 0 ? (
          <EmptyRow icon="◌">Loading sessions…</EmptyRow>
        ) : filtered.length === 0 && rows.length > 0 ? (
          <EmptyRow icon="∅">No sessions match the current filter.</EmptyRow>
        ) : rows.length === 0 ? (
          <EmptyRow icon="▸">
            No sessions yet. Spawn one with{' '}
            <code class="pty-tile__ticket">spawn-claude-feature &lt;TICKET&gt; &lt;slug&gt; --prompt-file &lt;path&gt; --full-auto</code>{' '}
            or <code class="pty-tile__ticket">/fleet:spawn &lt;TICKET&gt;</code> from a Claude Code session.
          </EmptyRow>
        ) : (
          filtered.map((r) => (
            <div
              key={r.ticket}
              class="session-table__row"
              role="row"
              onClick={() => onRowClick?.(r)}
            >
              <div role="cell" class="session-table__ticket">{r.ticket}</div>
              <div role="cell" style={{ color: 'var(--color-text-secondary)' }}>{r.slug || '—'}</div>
              <div role="cell">
                <Badge state={r.state} />
                {r.drift != null && r.drift > 0.6 ? (
                  <span
                    title={`Drift score ${Math.round(r.drift * 100)}% — agent may be stuck`}
                    class="tape tape--warn"
                    style={{ marginLeft: 'var(--space-1)' }}
                  >
                    DRIFT
                  </span>
                ) : null}
              </div>
              <div role="cell" class="session-table__id" style={{ color: r.parent ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>
                {r.parent || '—'}
              </div>
              <div role="cell" class="session-table__hash">
                {r.branch || '—'}
              </div>
              <div role="cell" style={{ color: 'var(--color-text-secondary)' }}>{r.activity}</div>
              <div role="cell" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-primary)' }}>{r.cost}</div>
              <div role="cell" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>{r.runtime}</div>
              <div role="cell">
                <div class="session-table__progress" aria-label={`${Math.round(r.progress * 100)}% complete`}>
                  <div
                    class="session-table__progress-bar"
                    style={{ width: `${Math.round(r.progress * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyRow({ children, icon = '∅' }: { children: preact.ComponentChildren; icon?: string }) {
  return (
    <div role="row" class="empty-state" style={{ border: 0 }}>
      <span class="empty-state__icon">{icon}</span>
      {children}
    </div>
  );
}
