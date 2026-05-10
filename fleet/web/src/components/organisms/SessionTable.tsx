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
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          Session Table
        </h2>
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
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          {filtered.length} / {rows.length}
        </span>
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
          <EmptyRow>Loading sessions…</EmptyRow>
        ) : filtered.length === 0 && rows.length > 0 ? (
          <EmptyRow>No sessions match the current filter.</EmptyRow>
        ) : rows.length === 0 ? (
          <EmptyRow>
            No sessions yet. Spawn one with{' '}
            <code>spawn-claude-feature &lt;TICKET&gt; &lt;slug&gt; --prompt-file &lt;path&gt; --full-auto</code>{' '}
            or <code>/fleet:spawn &lt;TICKET&gt;</code> from a Claude Code session.
          </EmptyRow>
        ) : (
          filtered.map((r) => (
            <div
              key={r.ticket}
              class="session-table__row"
              role="row"
              onClick={() => onRowClick?.(r)}
            >
              <div role="cell" style={{ fontWeight: 600 }}>{r.ticket}</div>
              <div role="cell" style={{ color: 'var(--color-text-secondary)' }}>{r.slug || '—'}</div>
              <div role="cell">
                <Badge state={r.state} />
                {r.drift != null && r.drift > 0.6 ? (
                  <span
                    title={`Drift score ${Math.round(r.drift * 100)}% — agent may be stuck`}
                    style={{ marginLeft: 6, color: 'var(--color-state-needs-input)', fontSize: 'var(--text-xs)' }}
                  >
                    ⚠
                  </span>
                ) : null}
              </div>
              <div role="cell" style={{ color: 'var(--color-text-secondary)' }}>
                {r.parent || '—'}
              </div>
              <div role="cell" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                {r.branch || '—'}
              </div>
              <div role="cell">{r.activity}</div>
              <div role="cell">{r.cost}</div>
              <div role="cell">{r.runtime}</div>
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

function EmptyRow({ children }: { children: preact.ComponentChildren }) {
  return (
    <div
      role="row"
      style={{
        padding: '32px 16px',
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {children}
    </div>
  );
}
