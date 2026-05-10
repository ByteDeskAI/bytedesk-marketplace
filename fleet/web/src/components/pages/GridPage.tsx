// GridPage — Phase 12.1 (BDM-28, B3). Multi-PTY grid view.
// Route: #/grid

import { AppShell } from '../templates/AppShell';
import { GridLayout, GRID_STRATEGIES, type GridStrategy } from '../organisms/GridLayout';
import { PtyTile } from '../organisms/PtyTile';
import { useSessionList } from '../../hooks/useSessionList';
import { usePersistentState } from '../../hooks/usePersistentState';

const ACTIVE = new Set(['starting', 'working', 'needs-input', 'reviewing']);

export function GridPage() {
  const sessions = useSessionList();
  const [strategy, setStrategy] = usePersistentState<GridStrategy>('fleet.grid', '2x2');

  const max = GRID_STRATEGIES.find((s) => s.id === strategy)?.max ?? 4;
  const tiles = (sessions.data ?? [])
    .filter((r) => ACTIVE.has(r.state))
    .slice(0, max);

  return (
    <AppShell activeView="sessions" topBarTitle="Multi-Agent Grid">
      <div class="grid-page">
        <div class="grid-page__toolbar">
          <strong style={{ fontSize: 'var(--text-sm)' }}>Layout:</strong>
          <span class="filter-chips" role="group" aria-label="Layout">
            {GRID_STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                class={`filter-chip${s.id === strategy ? ' filter-chip--active' : ''}`}
                onClick={() => setStrategy(s.id)}
              >
                {s.label}
              </button>
            ))}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
            {tiles.length} / {(sessions.data ?? []).filter((r) => ACTIVE.has(r.state)).length} active
          </span>
        </div>

        {tiles.length === 0 ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            No active sessions to grid. Spawn one or two and reload.
          </div>
        ) : (
          <GridLayout strategy={strategy}>
            {tiles.map((r) => <PtyTile key={r.ticket} row={r} />)}
          </GridLayout>
        )}
      </div>
    </AppShell>
  );
}
