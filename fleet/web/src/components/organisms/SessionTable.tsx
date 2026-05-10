import { Badge } from '../atoms/Badge';
import { SearchField } from '../molecules/SearchField';
import type { SessionRow } from '../../api';

export interface SessionTableProps {
  rows: SessionRow[];
  loading?: boolean;
  onRowClick?: (row: SessionRow) => void;
}

export function SessionTable({ rows, loading, onRowClick }: SessionTableProps) {
  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          Session Table
        </h2>
        <span style={{ flex: 1 }} />
        <div style={{ width: 240 }}>
          <SearchField placeholder="Filter sessions…" />
        </div>
      </header>
      <div class="session-table" role="table" aria-label="Sessions">
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
        ) : rows.length === 0 ? (
          <EmptyRow>
            No sessions yet. Spawn one with{' '}
            <code>spawn-claude-feature &lt;TICKET&gt; &lt;slug&gt; --prompt-file &lt;path&gt; --full-auto</code>{' '}
            or <code>/fleet:spawn &lt;TICKET&gt;</code> from a Claude Code session.
          </EmptyRow>
        ) : (
          rows.map((r) => (
            <div
              key={r.ticket}
              class="session-table__row"
              role="row"
              onClick={() => onRowClick?.(r)}
            >
              <div role="cell" style={{ fontWeight: 600 }}>{r.ticket}</div>
              <div role="cell" style={{ color: 'var(--color-text-secondary)' }}>{r.slug || '—'}</div>
              <div role="cell"><Badge state={r.state} /></div>
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
