/**
 * GlobalTerminal — fullscreen + resizable bottom-drawer tabbed tmux interface.
 *
 * Modes:
 *   full  — covers the entire viewport below the header (default on open)
 *   half  — ~50 % of viewport height (or last dragged height)
 *
 * The top edge is a drag handle: grab and pull to any height between
 * 160 px and fullscreen. Framer Motion animates mode transitions;
 * drag updates height via inline style for zero-latency resize.
 *
 * Each TerminalPanel stays mounted (visibility:hidden) so the xterm.js
 * instance and WebSocket survive tab switches.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TerminalPanel from './TerminalPanel';

interface TmuxSession {
  key: string;
  command: string;
  startedAt: number;
}

type TerminalMode = 'full' | 'half';

const HEADER_H = 56;   // matches header height in App.tsx
const MIN_H    = 160;  // minimum drag height
const TAB_H    = 36;
const DRAG_H   = 5;    // drag handle height

const C = {
  bg:        '#0d1117',
  tabBar:    '#161b22',
  tabBorder: 'rgba(255,255,255,0.08)',
  tabActive: '#58a6ff',
  tabText:   '#8b949e',
  tabTextOn: '#e6edf3',
  handle:    'rgba(255,255,255,0.06)',
  handleHov: 'rgba(255,255,255,0.14)',
  dragHov:   'rgba(88,166,255,0.4)',
};

const spring = { type: 'spring' as const, damping: 34, stiffness: 320 };

function fullH() { return window.innerHeight - HEADER_H; }
function halfH() { return Math.round((window.innerHeight - HEADER_H) * 0.5); }

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

export default function GlobalTerminal({ isOpen, onToggle }: Props) {
  const [sessions, setSessions]   = useState<TmuxSession[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [creating, setCreating]   = useState(false);
  const [mode, setMode]           = useState<TerminalMode>('full');
  // customHeight: set while dragging; null means use mode default
  const [customHeight, setCustomHeight] = useState<number | null>(null);

  const mountedRef = useRef(false);
  const dragRef    = useRef<{ startY: number; startH: number } | null>(null);

  // Resolve effective panel height (not including drag bar)
  const panelH = useMemo(() => {
    if (customHeight !== null) return customHeight;
    return mode === 'full' ? fullH() : halfH();
  }, [mode, customHeight]);

  // ── Session loading ────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/tmux/sessions');
      const body = await r.json() as { ok: boolean; sessions: TmuxSession[] };
      if (body.ok && body.sessions.length > 0) {
        setSessions(body.sessions);
        setActiveKey(prev => prev ?? body.sessions[body.sessions.length - 1].key);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen && !mountedRef.current) {
      mountedRef.current = true;
      loadSessions();
    }
  }, [isOpen, loadSessions]);

  // ── Drag-to-resize ─────────────────────────────────────────────────────────

  const onDragMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    const raw = Math.min(Math.max(dragRef.current.startH + delta, MIN_H), fullH());
    setCustomHeight(raw);
    // Snap mode label (doesn't change layout — just tracks state)
    setMode(raw >= fullH() - 8 ? 'full' : 'half');
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [onDragMove]);

  function onDragStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: panelH };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  useEffect(() => () => { onDragEnd(); }, [onDragEnd]);

  // ── Mode toggle ────────────────────────────────────────────────────────────

  function toggleMode() {
    const next: TerminalMode = mode === 'full' ? 'half' : 'full';
    setMode(next);
    setCustomHeight(null); // reset to default for chosen mode
  }

  // ── Session management ─────────────────────────────────────────────────────

  async function newSession() {
    setCreating(true);
    try {
      const r = await fetch('/api/tmux/sessions', { method: 'POST' });
      const body = await r.json() as { ok: boolean; session_key: string; startedAt: number };
      if (body.ok) {
        const s: TmuxSession = { key: body.session_key, command: 'shell', startedAt: body.startedAt };
        setSessions(prev => [...prev, s]);
        setActiveKey(body.session_key);
      }
    } catch {} finally { setCreating(false); }
  }

  function closeTab(key: string) {
    fetch(`/api/plan/kill/${key}`, { method: 'POST' }).catch(() => {});
    setSessions(prev => {
      const next = prev.filter(s => s.key !== key);
      setActiveKey(curr => curr !== key ? curr : (next.length > 0 ? next[next.length - 1].key : null));
      return next;
    });
  }

  function shortLabel(key: string) {
    if (key.startsWith('shell-')) return 'shell';
    if (key.startsWith('PLAN-')) return `PLAN·${key.slice(-3)}`;
    return key;
  }

  // ── Total height for animation (drag bar + tab bar + body) ────────────────
  const totalH = panelH + DRAG_H;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="global-terminal"
          initial={{ y: totalH }}
          animate={{ y: 0, height: totalH }}
          exit={{ y: totalH }}
          transition={spring}
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: totalH,
            zIndex: 250,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 -8px 48px rgba(0,0,0,0.6)',
            border: `1px solid ${C.tabBorder}`,
            borderBottom: 'none',
            overflow: 'hidden',
          }}
        >
          {/* ── Drag handle ── */}
          <div
            onMouseDown={onDragStart}
            style={{
              height: DRAG_H,
              flexShrink: 0,
              background: C.tabBar,
              cursor: 'ns-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: `1px solid ${C.tabBorder}`,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.dragHov; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.tabBar; }}
          >
            {/* Pill visual */}
            <div style={{ width: 36, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.18)' }} />
          </div>

          {/* ── Tab bar ── */}
          <div style={{
            height: TAB_H,
            flexShrink: 0,
            background: C.tabBar,
            display: 'flex',
            alignItems: 'stretch',
            borderBottom: `1px solid ${C.tabBorder}`,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}>
            {/* Terminal label */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 14px',
              borderRight: `1px solid ${C.tabBorder}`,
              flexShrink: 0,
            }}>
              <TerminalIcon size={13} color={C.tabText} />
              <span style={{
                fontSize: 11, fontWeight: 600, color: C.tabText,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                fontFamily: 'monospace',
              }}>
                Terminal
              </span>
            </div>

            {/* Session tabs */}
            <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto', minWidth: 0 }}>
              {sessions.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px' }}>
                  <span style={{ fontSize: 11, color: C.tabText, fontFamily: 'monospace', fontStyle: 'italic' }}>
                    No sessions — click + to open a shell
                  </span>
                </div>
              ) : sessions.map(s => {
                const isActive = s.key === activeKey;
                return (
                  <button
                    key={s.key}
                    onClick={() => setActiveKey(s.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '0 12px',
                      background: isActive ? 'rgba(88,166,255,0.08)' : 'transparent',
                      border: 'none',
                      borderRight: `1px solid ${C.tabBorder}`,
                      borderBottom: isActive ? `2px solid ${C.tabActive}` : '2px solid transparent',
                      cursor: 'pointer',
                      color: isActive ? C.tabTextOn : C.tabText,
                      fontSize: 12, fontFamily: 'monospace',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      transition: 'color 0.1s, border-color 0.1s, background 0.1s',
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: isActive ? C.tabActive : C.tabText,
                      opacity: isActive ? 1 : 0.5,
                    }} />
                    {shortLabel(s.key)}
                    <button
                      onClick={e => { e.stopPropagation(); closeTab(s.key); }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: C.tabText, fontSize: 13, lineHeight: 1,
                        padding: '1px 2px', marginLeft: 2, borderRadius: 3,
                        display: 'flex', alignItems: 'center', opacity: 0.5,
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff7b72'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.tabText; (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                      title="Close session"
                    >
                      x
                    </button>
                  </button>
                );
              })}
            </div>

            {/* Right controls */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 1,
              padding: '0 6px', flexShrink: 0,
              borderLeft: `1px solid ${C.tabBorder}`,
            }}>
              {/* New shell */}
              <IconBtn onClick={newSession} disabled={creating} title="New shell">
                +
              </IconBtn>
              {/* Restore / Maximise */}
              <IconBtn onClick={toggleMode} title={mode === 'full' ? 'Restore down' : 'Maximize'}>
                {mode === 'full' ? <RestoreIcon /> : <MaximizeIcon />}
              </IconBtn>
              {/* Close panel */}
              <IconBtn onClick={onToggle} title="Close terminal">
                X
              </IconBtn>
            </div>
          </div>

          {/* ── Terminal body ── */}
          <div style={{ flex: 1, background: C.bg, position: 'relative', overflow: 'hidden' }}>
            {sessions.length === 0 ? (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 16,
              }}>
                <TerminalIcon size={40} color="rgba(88,166,255,0.25)" />
                <p style={{ fontSize: 13, color: C.tabText, margin: 0, fontFamily: 'monospace' }}>
                  No active sessions
                </p>
                <button
                  onClick={newSession}
                  style={{
                    padding: '7px 20px',
                    background: 'rgba(88,166,255,0.12)',
                    border: `1px solid rgba(88,166,255,0.35)`,
                    borderRadius: 5,
                    color: C.tabActive,
                    fontSize: 12, fontFamily: 'monospace',
                    cursor: 'pointer', letterSpacing: '0.04em',
                  }}
                >
                  + New shell
                </button>
              </div>
            ) : sessions.map(s => (
              <div
                key={s.key}
                style={{
                  position: 'absolute', inset: 0,
                  visibility: s.key === activeKey ? 'visible' : 'hidden',
                  pointerEvents: s.key === activeKey ? 'auto' : 'none',
                }}
              >
                <TerminalPanel sessionKey={s.key} onClose={() => closeTab(s.key)} />
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Small reusable icon button ────────────────────────────────────────────────

function IconBtn({
  children, onClick, disabled, title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'none', border: 'none',
        cursor: disabled ? 'wait' : 'pointer',
        color: '#8b949e',
        fontSize: 13, lineHeight: 1,
        width: 28, height: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 4,
        fontFamily: 'monospace',
        transition: 'color 0.1s, background 0.1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.color = '#e6edf3';
        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.color = '#8b949e';
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

export function TerminalIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polyline points="2,5 6,8 2,11" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8" y1="11" x2="14" y2="11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  // Single square — "go fullscreen"
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="10" height="10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RestoreIcon() {
  // Two overlapping squares — "restore to smaller"
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="3.5" y="0.5" width="8" height="8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="0.5" y="3.5" width="8" height="8" stroke="currentColor" strokeWidth="1.2" fill="#161b22" />
    </svg>
  );
}
