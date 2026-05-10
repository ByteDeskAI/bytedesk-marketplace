// GridPage — Phase 12.1 (BDM-28, B3). Multi-PTY grid view.
// Route: #/grid
//
// Always renders a "main" tile first (connected to a persistent
// dashboard-owned tmux session). New fleet sessions auto-populate
// after the main tile, capped by the layout strategy's max.
//
// Tile rendering is *sticky*: once a session is mounted into the grid,
// it stays mounted (with the same React key) across transient API
// hiccups. A tile is only removed when its session reaches a terminal
// state (done/completed) or when its meta file is gone for ≥3
// consecutive polls. Without stickiness, the InteractiveTerminal
// remounts on every flap → the WS reconnects → tmux re-attaches and
// the user sees claude's TUI redraw from the top each time.

import { useEffect, useRef, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { GridLayout, GRID_STRATEGIES, type GridStrategy } from '../organisms/GridLayout';
import { PtyTile } from '../organisms/PtyTile';
import { MainTile } from '../organisms/MainTile';
import { useSessionList } from '../../hooks/useSessionList';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useViewMode } from '../../contexts/ViewModeContext';
import type { SessionRow } from '../../api';

// "Live" set — anything that's still attached to a tmux session. Done /
// completed / idle drop off the grid; everything else (including
// error / blocked) stays so the user can see the broken state and act.
const ACTIVE = new Set(['starting', 'working', 'needs-input', 'reviewing', 'error', 'blocked']);

// How many consecutive polls a ticket can be missing before we drop it.
const STICKY_TOLERANCE = 3;

/** True if two SessionRow objects represent the same observable tile —
 *  identical state and headline metadata. Used to avoid unnecessary
 *  React state updates when the API returns "the same data" again. */
function sameSessionRow(a: SessionRow, b: SessionRow): boolean {
  return (
    a.ticket === b.ticket &&
    a.state === b.state &&
    a.parent === b.parent &&
    a.branch === b.branch &&
    a.cost === b.cost &&
    a.runtime === b.runtime &&
    a.activity === b.activity &&
    a.progress === b.progress
  );
}

export function GridPage() {
  const sessions = useSessionList();
  const [strategy, setStrategy] = usePersistentState<GridStrategy>('fleet.grid', '2x2');
  const { mode, setMode } = useViewMode();

  // Sticky tile bookkeeping — tickets we've ever seen + a missing-poll
  // counter so transient empty fetches don't drop the tile.
  const [stickyTiles, setStickyTiles] = useState<SessionRow[]>([]);
  const missingCounts = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!sessions.data) return; // wait until we have at least one fetch
    const live = sessions.data.filter((r) => ACTIVE.has(r.state));
    const liveByTicket = new Map(live.map((r) => [r.ticket, r]));
    // Index sessions by ticket regardless of state so we can detect
    // a transition to a TERMINAL state (done/completed/idle) and drop
    // the tile immediately, without waiting for STICKY_TOLERANCE polls.
    const finishedTickets = new Set(
      sessions.data.filter((r) => !ACTIVE.has(r.state)).map((r) => r.ticket)
    );

    setStickyTiles((prev) => {
      const next: SessionRow[] = [];
      const seen = new Set<string>();
      let changed = prev.length === 0 && live.length > 0;
      // Existing tiles: keep, refresh data, or expire.
      for (let i = 0; i < prev.length; i++) {
        const row = prev[i];
        const fresh = liveByTicket.get(row.ticket);
        if (fresh) {
          missingCounts.current[row.ticket] = 0;
          // If the row data is byte-for-byte identical, KEEP the prev
          // reference so React/Preact's reconciler stays calm.
          const reuse = sameSessionRow(row, fresh) ? row : fresh;
          if (reuse !== row) changed = true;
          next.push(reuse);
          seen.add(row.ticket);
        } else if (finishedTickets.has(row.ticket)) {
          // Session reached a terminal state (done / completed / idle).
          // Drop immediately — no sticky hold, no chance of a stale
          // tile pointing at a tmux session the reaper just killed.
          delete missingCounts.current[row.ticket];
          changed = true;
        } else {
          missingCounts.current[row.ticket] = (missingCounts.current[row.ticket] ?? 0) + 1;
          if (missingCounts.current[row.ticket] < STICKY_TOLERANCE) {
            next.push(row);
            seen.add(row.ticket);
          } else {
            changed = true; // dropped a tile
          }
        }
      }
      // New tiles we haven't seen before.
      for (const row of live) {
        if (!seen.has(row.ticket)) {
          missingCounts.current[row.ticket] = 0;
          next.push(row);
          changed = true;
        }
      }
      // Skip the state update entirely when the result is reference-
      // equivalent to prev — this avoids a parent re-render that would
      // force every child to reconcile (and risk a remount) on every
      // poll tick.
      if (!changed && next.length === prev.length) {
        return prev;
      }
      return next;
    });
  }, [sessions.data]);

  const max = GRID_STRATEGIES.find((s) => s.id === strategy)?.max ?? 4;
  // Main tile is always tile #0; fleet child sessions fill the rest.
  const fleetSlots = Math.max(0, max - 1);
  const fleetTiles = stickyTiles.slice(0, fleetSlots);
  const totalActive = stickyTiles.length;

  return (
    <AppShell activeView="grid" topBarTitle="Multi-Agent Grid">
      <div class="grid-page">
        <div class="grid-page__toolbar">
          <span class="grid-page__toolbar-label">LAYOUT</span>
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
          <span class="grid-page__toolbar-label" style={{ marginLeft: 'var(--space-3)' }}>MODE</span>
          <span class="filter-chips" role="group" aria-label="View mode">
            <button
              type="button"
              class={`filter-chip${mode === 'terminal' ? ' filter-chip--active' : ''}`}
              onClick={() => setMode('terminal')}
              title="xterm.js + tmux PTY"
            >
              Terminal
            </button>
            <button
              type="button"
              class={`filter-chip${mode === 'chat' ? ' filter-chip--active' : ''}`}
              onClick={() => setMode('chat')}
              title="Structured chat from jsonl"
            >
              Chat
            </button>
          </span>
          <span style={{ flex: 1 }} />
          <span class="tape">MAIN</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', letterSpacing: 'var(--tracking-mono)' }}>
            +<strong style={{ color: 'var(--color-text-primary)' }}>{fleetTiles.length}</strong>
            <span style={{ color: 'var(--color-text-tertiary)' }}> / </span>
            <strong style={{ color: 'var(--color-text-primary)' }}>{totalActive}</strong>
            <span style={{ color: 'var(--color-text-tertiary)' }}> active</span>
          </span>
        </div>

        <GridLayout strategy={strategy} count={1 + fleetTiles.length}>
          <MainTile />
          {fleetTiles.map((r) => <PtyTile key={r.ticket} row={r} />)}
        </GridLayout>
      </div>
    </AppShell>
  );
}
