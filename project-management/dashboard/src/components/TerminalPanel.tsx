import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  sessionKey: string;
  /** Fixed pixel height, or omit to fill the parent container via flex */
  height?: number | string;
  onClose?: () => void;
}

export default function TerminalPanel({ sessionKey, height, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'ended' | 'error'>('connecting');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88,166,255,0.3)',
      },
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    termRef.current = term;
    fitRef.current = fitAddon;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/pty/${encodeURIComponent(sessionKey)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      // Fit after the container has its final layout, then tell the PTY the correct size
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        } catch { /* ignore */ }
      });
    };

    ws.onmessage = (ev) => {
      try {
        // Normalise: server sends text frames (string), but handle binary defensively
        const raw: string =
          typeof ev.data === 'string'
            ? ev.data
            : ev.data instanceof ArrayBuffer
            ? new TextDecoder().decode(ev.data)
            : '';
        if (!raw) return;
        const msg = JSON.parse(raw) as { type: string; data?: string; msg?: string };
        if (msg.type === 'output' && msg.data) term.write(msg.data);
        if (msg.type === 'error') {
          term.write(`\r\n\x1b[31mError: ${msg.msg ?? 'unknown'}\x1b[0m\r\n`);
          setStatus('error');
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[33m[Session ended — terminal closed]\x1b[0m\r\n');
      setStatus('ended');
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[WebSocket error — could not connect to session]\x1b[0m\r\n');
      setStatus('error');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        } catch { /* ignore */ }
      });
    });
    ro.observe(container);

    return () => {
      ws.close();
      term.dispose();
      ro.disconnect();
    };
  }, [sessionKey]);

  const statusDot = status === 'connected' ? '#3fb950'
    : status === 'connecting' ? '#d29922'
    : '#f85149';

  const statusLabel = status === 'connected' ? 'Running'
    : status === 'connecting' ? 'Connecting...'
    : status === 'ended' ? 'Ended'
    : 'Error';

  return (
    <div style={{
      background: '#0d1117',
      borderRadius: 6,
      border: '1px solid rgba(255,255,255,.14)',
      overflow: 'hidden',
      // When no fixed height: fill the parent flex container
      flex: height == null ? 1 : undefined,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px',
        background: '#161b22',
        borderBottom: '1px solid rgba(255,255,255,.08)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: statusDot,
          boxShadow: status === 'connected' ? `0 0 4px ${statusDot}` : 'none',
        }} />
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,.7)', flex: 1 }}>
          {sessionKey}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>{statusLabel}</span>
        {onClose && (
          <button
            onClick={onClose}
            title="Close terminal"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,.4)', fontSize: 16, padding: '0 2px',
              lineHeight: 1,
            }}
          >
            x
          </button>
        )}
      </div>
      <div ref={containerRef} style={{
        height: height ?? undefined,
        flex: height == null ? 1 : undefined,
        minHeight: 0,
        padding: '4px 0',
      }} />
    </div>
  );
}
