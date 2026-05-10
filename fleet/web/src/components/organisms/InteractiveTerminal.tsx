// InteractiveTerminal — Phase 12.1 (BDM-28, A4 attach).
//
// xterm.js bound to a per-session WebSocket at /api/sessions/<T>/pty.
// Wire shape (JSON):
//   client → server  {"type":"input","data":"ls\r"}
//   client → server  {"type":"resize","cols":120,"rows":34}
//   server → client  {"type":"output","data":"…"}
//   server → client  {"type":"size","cols":N,"rows":M}    on connect
//   server → client  {"type":"error","msg":"…"}
//
// Output is tailed from the existing tmux-pipe-pane log file from the
// moment of connect (no scrollback flood). For scrollback, the Logs tab
// still serves /api/sessions/<T>/log.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export interface InteractiveTerminalProps {
  ticket: string;
  /** Override the default ws path (`/api/sessions/<ticket>/pty`). The
   *  always-on main terminal passes `/api/main/pty`. */
  wsPath?: string;
}

export function InteractiveTerminal({ ticket, wsPath }: InteractiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono), monospace',
      fontSize: 14,
      theme: {
        background: '#0b0e14',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Input always goes through wsRef.current — reconnects swap the
    // ref and previous handlers stay intact.
    term.onData((d) => {
      const cur = wsRef.current;
      if (cur && cur.readyState === WebSocket.OPEN) {
        cur.send(JSON.stringify({ type: 'input', data: d }));
      }
    });

    let disposed = false;
    let backoffMs = 500;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const path = wsPath ?? `/api/sessions/${encodeURIComponent(ticket)}/pty`;
      const ws = new WebSocket(`${proto}//${window.location.host}${path}`);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        backoffMs = 500; // reset on successful open
        setStatus('open');
        setErrMsg(null);
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };
      ws.onclose = () => {
        if (disposed) return;
        setStatus('closed');
        // Schedule reconnect with exponential backoff, capped at 10s.
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, 10000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        setStatus('error');
        setErrMsg('WebSocket error');
      };
      ws.onmessage = (ev) => {
        let msg: { type: string; data?: string; cols?: number; rows?: number; msg?: string };
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'output':
            if (msg.data) {
              term.write(msg.data, () => {
                const buf = term.buffer.active;
                if (buf.viewportY >= buf.baseY) term.scrollToBottom();
              });
            }
            break;
          case 'size':
            break;
          case 'error':
            term.write(`\r\n\x1b[31m[fleet] ${msg.msg}\x1b[0m\r\n`);
            setErrMsg(msg.msg ?? 'error');
            break;
        }
      };
    };
    connect();

    let lastCols = 0;
    let lastRows = 0;
    let resizeTimer: number | undefined;
    const onResize = () => {
      // Debounce so a single layout settling doesn't fire 60+ times
      // per second; suppress the WS message when neither cols nor
      // rows changed (otherwise tmux's resize-pane → pane reflow →
      // ResizeObserver loops forever).
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        try { fit.fit(); } catch { /* container not laid out yet */ }
        const cols = term.cols, rows = term.rows;
        if (cols === lastCols && rows === lastRows) return;
        if (cols < 2 || rows < 2 || cols > 500 || rows > 500) return;
        lastCols = cols; lastRows = rows;
        const cur = wsRef.current;
        if (cur && cur.readyState === WebSocket.OPEN) {
          cur.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      }, 120);
    };
    window.addEventListener('resize', onResize);

    // ResizeObserver also: when the parent panel changes size.
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      if (resizeTimer) window.clearTimeout(resizeTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* */ }
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
    // Effect runs ONCE per mount. Ticket and wsPath are passed via key
    // = ticket on the PtyTile parent, so React/Preact remounts the
    // whole component when the ticket truly changes — we don't need
    // the effect to depend on these values. Empty deps array is the
    // explicit "mount-only" signal that prevents spurious WS
    // reconnects when the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel =
    status === 'open' ? 'LIVE' :
    status === 'connecting' ? 'CONNECTING' :
    status === 'closed' ? 'CLOSED' : 'ERROR';
  const statusGlyph =
    status === 'open' ? '●' :
    status === 'connecting' ? '◌' :
    status === 'closed' ? '○' : '✗';

  return (
    <div class="interactive-terminal">
      <div class="interactive-terminal__header">
        <span class={`interactive-terminal__status interactive-terminal__status--${status}`}>
          {statusGlyph} {statusLabel}
        </span>
        <span style={{ color: 'var(--color-border-strong)' }}>│</span>
        <span class="interactive-terminal__hint">PTY</span>
        <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{ticket}</span>
        {errMsg ? <span class="interactive-terminal__err">⚠ {errMsg}</span> : null}
      </div>
      <div ref={containerRef} class="interactive-terminal__xterm" />
    </div>
  );
}
