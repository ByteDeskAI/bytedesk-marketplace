// shared.tsx — small primitives every visualizer can reuse so the
// look stays consistent across tools.

import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export interface VizFrameProps {
  toolName: string;
  state?: 'running' | 'done' | 'error';
  /** Short, scannable summary line. */
  summary: ComponentChildren;
  /** Optional richer body, hidden behind expand toggle. */
  details?: ComponentChildren;
  /** Default the body to expanded. */
  defaultOpen?: boolean;
  /** Optional pill rendered to the right of the tool name. */
  rightAccessory?: ComponentChildren;
}

/** VizFrame is the standard chrome around any specialized tool card —
 *  one-line header (name + state + summary) with an optional expandable
 *  body. Used by every visualizer so they stack uniformly inside chat. */
export function VizFrame({
  toolName,
  state = 'done',
  summary,
  details,
  defaultOpen = false,
  rightAccessory,
}: VizFrameProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class={`viz viz--${state}`}>
      <button
        type="button"
        class="viz__head"
        onClick={() => details && setOpen(!open)}
        aria-expanded={open}
      >
        <span class="viz__name">{toolName}</span>
        <span class="viz__state">{state}</span>
        <span class="viz__summary">{summary}</span>
        <span class="viz__spacer" />
        {rightAccessory}
        {details ? <span class="viz__chev">{open ? '▾' : '▸'}</span> : null}
      </button>
      {open && details ? <div class="viz__body">{details}</div> : null}
    </div>
  );
}

/** Truncate a string to N chars with an ellipsis. */
export function trim(s: string, n: number): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

/** Stringify a value for display. Objects → JSON.stringify with indent;
 *  primitives → String(). Truncates long strings. */
export function display(v: unknown, maxLen = 200): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > maxLen ? v.slice(0, maxLen - 1) + '…' : v;
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
  } catch {
    return String(v);
  }
}
