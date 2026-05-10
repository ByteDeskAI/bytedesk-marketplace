// TerminalView — read-only embedded log viewer for a session. Subscribes
// to /api/sessions/<TICKET>/stream (SSE), receives a `snapshot` event on
// connect (last 8KB) and `append` events for each new chunk, renders into
// a monospace pre. Escape sequences are decoded server-side
// (encodeMultiline → JS unescape).
//
// Phase 4 ships read-only. Phase 5 adds /api/sessions/<TICKET>/send for
// input via a separate text input mounted alongside this view.

import { useEffect, useRef, useState } from 'preact/hooks';

export interface TerminalViewProps {
  ticket: string;
  height?: string | number;
}

function unescapeMultiline(s: string): string {
  // Inverse of server's encodeMultiline: \\ → \, \n → newline, \r → CR.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === 'n') { out += '\n'; i++; continue; }
      if (n === 'r') { out += '\r'; i++; continue; }
      if (n === '\\') { out += '\\'; i++; continue; }
    }
    out += c;
  }
  return out;
}

export function TerminalView({ ticket, height = 360 }: TerminalViewProps) {
  const [lines, setLines] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    setLines('');
    setError(null);
    const src = new EventSource(`/api/sessions/${encodeURIComponent(ticket)}/stream`);
    src.addEventListener('snapshot', (e) => {
      const data = (e as MessageEvent).data as string;
      setLines(unescapeMultiline(data));
    });
    src.addEventListener('append', (e) => {
      const data = (e as MessageEvent).data as string;
      setLines((prev) => prev + unescapeMultiline(data));
    });
    src.addEventListener('error', () => {
      // EventSource auto-reconnects; only surface a soft notice
      setError('connection interrupted');
    });
    return () => src.close();
  }, [ticket]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div class="terminal-view">
      {error ? (
        <div class="terminal-view__notice">
          <span class="tape tape--warn" style={{ marginRight: 'var(--space-2)' }}>RECONNECTING</span>
          {error}
        </div>
      ) : null}
      <pre ref={ref} class="terminal-view__pre" style={{ height: typeof height === 'number' ? `${height}px` : height }}>
        {lines || '(waiting for output…)'}
      </pre>
    </div>
  );
}
