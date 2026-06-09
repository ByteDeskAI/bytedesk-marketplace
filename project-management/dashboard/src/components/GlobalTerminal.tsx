/**
 * GlobalTerminal — persistent bottom-drawer tabbed tmux interface.
 *
 * Aesthetic: VS Code integrated terminal — dark #0d1117 body, #161b22
 * tab bar, #58a6ff active tab indicator. Monospace session names.
 * Spring-animated slide-up via Framer Motion.
 *
 * Each tab stays mounted (just hidden) so the WebSocket connection and
 * xterm.js state survive tab switches.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TerminalPanel from './TerminalPanel';

interface TmuxSession {
  key: string;
  command: string;
  startedAt: number;
}

const PANEL_HEIGHT = 380;
const TAB_H = 36;

// Color scheme — deliberate departure from Atlaskit tokens here; this is
// a terminal surface, not a UI surface. Same palette as TerminalPanel.
const C = {
  bg:        '#0d1117',
  tabBar:    '#161b22',
  tabBorder: 'rgba(255,255,255,0.08)',
  tabActive: '#58a6ff',
  tabText:   '#8b949e',
  tabTextOn: '#e6edf3',
  handle:    'rgba(255,255,255,0.06)',
  handleHov: 'rgba(255,255,255,0.12)',
};

const spring = { type: 'spring' as const, damping: 32, stiffness: 300 };

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

export default function GlobalTerminal({ isOpen, onToggle }: Props) {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const mountedRef = useRef(false);

  // Load existing sessions on first open
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

  async function newSession() {
    setCreating(true);
    try {
      const r = await fetch('/api/tmux/sessions', { method: 'POST' });
      const body = await r.json() as { ok: boolean; session_key: string; startedAt: number };
      if (body.ok) {
        const session: TmuxSession = { key: body.session_key, command: 'shell', startedAt: body.startedAt };
        setSessions(prev => [...prev, session]);
        setActiveKey(body.session_key);
      }
    } catch {}
    finally { setCreating(false); }
  }

  function closeTab(key: string) {
    // Kill the tmux session server-side (best effort)
    fetch(`/api/plan/kill/${key}`, { method: 'POST' }).catch(() => {});
    setSessions(prev => {
      const next = prev.filter(s => s.key !== key);
      setActiveKey(curr => {
        if (curr !== key) return curr;
        return next.length > 0 ? next[next.length - 1].key : null;
      });
      return next;
    });
  }

  function shortLabel(key: string): string {
    // PLAN-1234567890 → PLAN-567 (last 3 digits)
    // shell-1234567890 → shell
    // PMPT-3 → PMPT-3
    if (key.startsWith('shell-')) return 'shell';
    if (key.startsWith('PLAN-')) {
      const ts = key.replace('PLAN-', '');
      return `PLAN·${ts.slice(-3)}`;
    }
    return key;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="global-terminal"
          initial={{ y: PANEL_HEIGHT + TAB_H }}
          animate={{ y: 0 }}
          exit={{ y: PANEL_HEIGHT + TAB_H }}
          transition={spring}
          style={{
            position: 'fixed',
            bottom: 0,
            // Account for sidebar width (240px) — but sit on top of it at lower z-index
            left: 0,
            right: 0,
            height: PANEL_HEIGHT + TAB_H,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 -4px 32px rgba(0,0,0,0.5)',
            borderTop: `1px solid ${C.tabBorder}`,
          }}
        >
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
              <span style={{ fontSize: 11, fontWeight: 600, color: C.tabText, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Terminal
              </span>
            </div>

            {/* Session tabs */}
            <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto', minWidth: 0 }}>
              {sessions.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px' }}>
                  <span style={{ fontSize: 11, color: C.tabText, fontStyle: 'italic' }}>No sessions — click + to open a shell</span>
                </div>
              ) : (
                sessions.map(s => {
                  const isActive = s.key === activeKey;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setActiveKey(s.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '0 12px',
                        background: 'transparent',
                        border: 'none',
                        borderRight: `1px solid ${C.tabBorder}`,
                        borderBottom: isActive ? `2px solid ${C.tabActive}` : '2px solid transparent',
                        cursor: 'pointer',
                        color: isActive ? C.tabTextOn : C.tabText,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'color 0.1s, border-color 0.1s',
                      }}
                    >
                      {/* Session type dot */}
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: isActive ? C.tabActive : C.tabText,
                        opacity: isActive ? 1 : 0.5,
                        transition: 'background 0.1s',
                      }} />
                      {shortLabel(s.key)}
                      {/* Close button */}
                      <button
                        onClick={e => { e.stopPropagation(); closeTab(s.key); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: C.tabText, fontSize: 13, lineHeight: 1,
                          padding: '1px 2px', marginLeft: 2, borderRadius: 3,
                          display: 'flex', alignItems: 'center',
                          opacity: 0.6,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff7b72'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.tabText; (e.currentTarget as HTMLElement).style.opacity = '0.6'; }}
                        title="Close session"
                      >
                        ×
                      </button>
                    </button>
                  );
                })
              )}
            </div>

            {/* Right-side controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', flexShrink: 0, borderLeft: `1px solid ${C.tabBorder}` }}>
              {/* New shell button */}
              <button
                onClick={newSession}
                disabled={creating}
                title="New shell session"
                style={{
                  background: 'none', border: 'none', cursor: creating ? 'wait' : 'pointer',
                  color: C.tabText, fontSize: 16, lineHeight: 1, padding: '4px 6px',
                  borderRadius: 4, display: 'flex', alignItems: 'center',
                  transition: 'color 0.1s, background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.tabTextOn; (e.currentTarget as HTMLElement).style.background = C.handleHov; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.tabText; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                +
              </button>
              {/* Collapse button */}
              <button
                onClick={onToggle}
                title="Close terminal panel"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: C.tabText, fontSize: 13, lineHeight: 1, padding: '4px 6px',
                  borderRadius: 4, display: 'flex', alignItems: 'center',
                  transition: 'color 0.1s, background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.tabTextOn; (e.currentTarget as HTMLElement).style.background = C.handleHov; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.tabText; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* ── Terminal body ── */}
          <div style={{ flex: 1, background: C.bg, position: 'relative', overflow: 'hidden' }}>
            {sessions.length === 0 ? (
              /* Empty state — prompt to create */
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
              }}>
                <TerminalIcon size={32} color="rgba(88,166,255,0.3)" />
                <p style={{ fontSize: 13, color: C.tabText, margin: 0, fontFamily: 'monospace' }}>
                  No active sessions
                </p>
                <button
                  onClick={newSession}
                  style={{
                    padding: '6px 16px',
                    background: 'rgba(88,166,255,0.15)',
                    border: `1px solid rgba(88,166,255,0.4)`,
                    borderRadius: 4,
                    color: C.tabActive,
                    fontSize: 12, fontFamily: 'monospace',
                    cursor: 'pointer',
                  }}
                >
                  + New shell
                </button>
              </div>
            ) : (
              /* Mount all panels, show only the active one */
              sessions.map(s => (
                <div
                  key={s.key}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    // Use visibility + pointer-events instead of display:none
                    // so xterm.js stays alive and connected
                    visibility: s.key === activeKey ? 'visible' : 'hidden',
                    pointerEvents: s.key === activeKey ? 'auto' : 'none',
                  }}
                >
                  <TerminalPanel sessionKey={s.key} onClose={() => closeTab(s.key)} />
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Terminal icon SVG ─────────────────────────────────────────────────────────

export function TerminalIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Shell prompt chevron */}
      <polyline
        points="2,5 6,8 2,11"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Cursor underline */}
      <line
        x1="8" y1="11" x2="14" y2="11"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
