// ReplayPage — Phase 9 (BDM-25, B16). Time-travel scrub through a
// session's log. v1: log-only replay. The log file has no per-line
// timestamps today, so we treat each line as a "tick"; the scrub bar
// jumps by line index. Anchors come from the events feed (which DOES
// carry timestamps); clicking an event jumps the scrub to the closest
// log-line index produced before that event.
//
// v2 ideas (not in this phase): per-line tmux-pipe-pane timestamps;
// workspace snapshots via git stash so we can show file-tree changes
// at each tick.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { Button } from '../atoms/Button';
import { useRoute } from '../../hooks/useRoute';
import type { FleetEvent } from '../../api';

const FETCH_BYTES = 256 * 1024; // last 256 KB

export function ReplayPage() {
  const [, navigate] = useRoute();
  const route = parseTicketRoute();
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playRef = useRef<number | null>(null);

  const lines = useMemo(() => (log == null ? [] : log.split('\n')), [log]);

  useEffect(() => {
    if (!route.ticket) return;
    const ac = new AbortController();
    fetch(`/api/sessions/${encodeURIComponent(route.ticket)}/log?bytes=${FETCH_BYTES}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((txt) => { setLog(txt); setPosition(txt.split('\n').length - 1); })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setError((e as Error).message); });

    fetch(`/api/events?limit=200`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((all: FleetEvent[]) => setEvents(all.filter((e) => e.ticket === route.ticket)))
      .catch(() => { /* events are advisory */ });
    return () => ac.abort();
  }, [route.ticket]);

  // Playback driver. Advances `position` by one tick at the chosen speed.
  useEffect(() => {
    if (!playing) return;
    const ms = Math.max(20, 200 / speed);
    playRef.current = window.setInterval(() => {
      setPosition((p) => {
        if (p >= lines.length - 1) {
          setPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, ms);
    return () => {
      if (playRef.current != null) window.clearInterval(playRef.current);
      playRef.current = null;
    };
  }, [playing, speed, lines.length]);

  if (!route.ticket) {
    return (
      <AppShell activeView="sessions" topBarTitle="Replay">
        <div>No ticket in route. Navigate from the session detail panel.</div>
      </AppShell>
    );
  }

  return (
    <AppShell activeView="sessions" topBarTitle={`Replay — ${route.ticket}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button onClick={() => navigate('/')}>← Back to overview</Button>
        <span style={{ flex: 1 }} />
        <Button onClick={() => setPlaying((p) => !p)} disabled={lines.length === 0}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </Button>
        <span style={{ display: 'inline-flex', gap: 4 }} role="group" aria-label="Speed">
          {[0.5, 1, 2, 4].map((s) => (
            <button
              key={s}
              type="button"
              class={`filter-chip${s === speed ? ' filter-chip--active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </span>
      </div>

      {error ? <div style={{ color: 'var(--color-state-error)' }}>Couldn't load log: {error}</div> : null}

      <div class="replay">
        <pre class="replay__terminal" aria-label="Replay terminal">
          {lines.slice(0, position + 1).join('\n')}
        </pre>

        <input
          class="replay__scrub"
          type="range"
          min={0}
          max={Math.max(0, lines.length - 1)}
          value={position}
          onInput={(e) => {
            setPlaying(false);
            setPosition(Number((e.currentTarget as HTMLInputElement).value));
          }}
          aria-label="Scrub timeline"
        />
        <div class="replay__meta">
          <span>line {position + 1} / {lines.length}</span>
          {events.length > 0 ? (
            <span style={{ marginLeft: 16 }}>
              {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        {events.length > 0 ? (
          <ol class="replay__events">
            {events.map((e, i) => (
              <li key={e.id} class="replay__event">
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    // Map event index → proportional line position.
                    const target = Math.round(((i + 1) / events.length) * (lines.length - 1));
                    setPlaying(false);
                    setPosition(target);
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>{' '}
                  <strong>{e.kind}</strong>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </AppShell>
  );
}

function parseTicketRoute(): { ticket: string | null } {
  const m = /^#\/?sessions\/([^/]+)\/replay$/.exec(window.location.hash);
  return { ticket: m ? decodeURIComponent(m[1]) : null };
}
