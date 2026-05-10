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
}

export function InteractiveTerminal({ ticket }: InteractiveTerminalProps) {
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
      fontSize: 12,
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

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/sessions/${encodeURIComponent(ticket)}/pty`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      // Send our current size to tmux.
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onclose = () => setStatus('closed');
    ws.onerror = () => { setStatus('error'); setErrMsg('WebSocket error'); };

    ws.onmessage = (ev) => {
      let msg: { type: string; data?: string; cols?: number; rows?: number; msg?: string };
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'output':
          if (msg.data) term.write(msg.data);
          break;
        case 'size':
          // Ignored today; tmux will follow our client side via resize-pane.
          break;
        case 'error':
          term.write(`\r\n\x1b[31m[fleet] ${msg.msg}\x1b[0m\r\n`);
          setErrMsg(msg.msg ?? 'error');
          break;
      }
    };

    const sendInput = (d: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: d }));
      }
    };
    term.onData(sendInput);

    const onResize = () => {
      try { fit.fit(); } catch { /* container not laid out yet */ }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener('resize', onResize);

    // ResizeObserver also: when the parent panel changes size.
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      try { ws.close(); } catch { /* */ }
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [ticket]);

  return (
    <div class="interactive-terminal">
      <div class="interactive-terminal__header">
        <span class={`interactive-terminal__status interactive-terminal__status--${status}`}>
          {status === 'open' ? '● live' : status === 'connecting' ? '○ connecting' : status === 'closed' ? '○ closed' : '✗ error'}
        </span>
        <span class="interactive-terminal__hint">PTY · {ticket}</span>
        {errMsg ? <span class="interactive-terminal__err">{errMsg}</span> : null}
      </div>
      <div ref={containerRef} class="interactive-terminal__xterm" />
    </div>
  );
}
