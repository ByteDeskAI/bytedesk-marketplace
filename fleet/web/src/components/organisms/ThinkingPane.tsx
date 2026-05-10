// ThinkingPane — Phase 12.x (feature #8). Live trace of "what claude is
// reasoning about right now": filters the SSE transcript stream from
// useSessionStats() down to thinking + text events and renders a
// vertically-scrolling feed.
//
// Different colors per type so a glance at the column tells you whether
// claude is still cogitating (thinking) or has produced visible output
// (text). Truncates long bodies to keep the column readable.

import { useSessionStats } from '../../hooks/useSessionStats';
import type { TranscriptEvent } from '../../api';

const TRUNCATE = 360;

function colorFor(type: string): string {
  if (type === 'thinking') return 'var(--color-state-reviewing)';
  if (type === 'text') return 'var(--color-text-primary)';
  return 'var(--color-text-secondary)';
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString();
}

function truncate(s: string, n = TRUNCATE): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export interface ThinkingPaneProps {
  ticket: string;
}

export function ThinkingPane({ ticket }: ThinkingPaneProps) {
  const { recentEvents } = useSessionStats(ticket);
  const filtered = recentEvents.filter(
    (e: TranscriptEvent) => e.type === 'thinking' || e.type === 'text',
  );

  if (filtered.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
        No reasoning trace yet. Live thinking and text events will stream here as
        claude produces them.
      </div>
    );
  }

  return (
    <ol class="thinking-pane">
      {filtered.map((e, i) => {
        const body = (e.text ?? '').trim();
        return (
          <li
            key={`${e.timestamp}-${i}`}
            class={`thinking-pane__row thinking-pane__row--${e.type}`}
          >
            <header class="thinking-pane__head">
              <span class="thinking-pane__time">{fmtTime(e.timestamp)}</span>
              <span
                class="thinking-pane__type"
                style={{ color: colorFor(String(e.type)) }}
              >
                {e.type}
              </span>
            </header>
            <div
              class="thinking-pane__body"
              style={{ color: colorFor(String(e.type)) }}
            >
              {body ? truncate(body) : <em style={{ opacity: 0.5 }}>(empty)</em>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
