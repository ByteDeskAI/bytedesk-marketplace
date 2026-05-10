// ToolTimeline — Phase 12.x (feature #9). Cross-session tool-use
// timeline. One row per active session, x-axis = the last 60 seconds of
// wall clock. Each tool_use transcript event lands as a colored square
// at its timestamp's position.
//
// Renders as a sticky row of rows: title column on the left, scaled
// 60-second strip on the right with absolutely positioned dots.

import { useEffect, useState } from 'preact/hooks';
import { useSessionList } from '../../hooks/useSessionList';
import { useSessionStats } from '../../hooks/useSessionStats';
import type { SessionRow, TranscriptEvent } from '../../api';

const WINDOW_MS = 60_000;
const TICK_MS = 1_000;

// Stable color for an arbitrary tool name. Hash the string so the same
// tool always paints the same hue across sessions.
function colorFor(tool: string): string {
  let h = 0;
  for (let i = 0; i < tool.length; i++) {
    h = (h * 31 + tool.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 70% 50%)`;
}

export function ToolTimeline() {
  const sessions = useSessionList();
  const rows = (sessions.data ?? []).filter((r) =>
    ['starting', 'working', 'needs-input', 'reviewing', 'error', 'blocked'].includes(r.state),
  );

  // Force a re-render so dots fall off the left edge as time passes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  if (sessions.error) {
    return <div style={{ color: 'var(--color-state-error)' }}>{sessions.error.message}</div>;
  }
  if (rows.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-tertiary)' }}>
        No active sessions to chart.
      </div>
    );
  }

  return (
    <div class="tool-timeline">
      <header class="tool-timeline__legend">
        <span class="tool-timeline__legend-name">Session</span>
        <div class="tool-timeline__legend-axis" aria-hidden="true">
          <span>−60s</span>
          <span>−30s</span>
          <span>now</span>
        </div>
      </header>
      <ul class="tool-timeline__rows">
        {rows.map((row) => (
          <ToolTimelineRow key={row.ticket} row={row} />
        ))}
      </ul>
    </div>
  );
}

function ToolTimelineRow({ row }: { row: SessionRow }) {
  const { recentEvents } = useSessionStats(row.ticket);
  const now = Date.now();
  const tools = recentEvents.filter(
    (e: TranscriptEvent) => e.type === 'tool_use' && !!e.tool_name,
  );

  const dots = tools
    .map((e) => {
      const t = new Date(e.timestamp).getTime();
      if (Number.isNaN(t)) return null;
      const age = now - t;
      if (age < 0 || age > WINDOW_MS) return null;
      const pct = 100 - (age / WINDOW_MS) * 100;
      return { pct, name: e.tool_name as string, ts: e.timestamp };
    })
    .filter((x): x is { pct: number; name: string; ts: string } => x !== null);

  return (
    <li class="tool-timeline__row">
      <span class="tool-timeline__name" title={row.ticket}>
        <strong>{row.ticket}</strong>
        <span class="tool-timeline__slug">{row.slug}</span>
      </span>
      <div class="tool-timeline__strip">
        {dots.map((d, i) => (
          <span
            key={`${d.ts}-${i}`}
            class="tool-timeline__dot"
            style={{ left: `${d.pct}%`, background: colorFor(d.name) }}
            title={`${d.name} @ ${new Date(d.ts).toLocaleTimeString()}`}
          />
        ))}
      </div>
    </li>
  );
}
