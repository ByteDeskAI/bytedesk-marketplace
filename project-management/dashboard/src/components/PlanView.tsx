import { useState, useCallback, useEffect } from 'react';
import Button from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import TerminalPanel from './TerminalPanel';

interface PlanSession {
  key: string;
  startedAt: string;
}

export default function PlanView() {
  const [sessions, setSessions] = useState<PlanSession[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    fetch('/api/plan/sessions')
      .then(r => r.json() as Promise<{ ok: boolean; sessions: Array<{ key: string; startedAt: number }> }>)
      .then(body => {
        if (body.ok && body.sessions.length > 0) {
          const restored = body.sessions.map(s => ({
            key: s.key,
            startedAt: new Date(s.startedAt * 1000).toISOString(),
          }));
          setSessions(restored);
          setActiveKey(restored[restored.length - 1].key);
        }
      })
      .catch(() => {})
      .finally(() => setHydrating(false));
  }, []);

  const startPlan = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const r = await fetch('/api/plan/start', { method: 'POST' });
      const body = await r.json() as { ok: boolean; session_key?: string; error?: string };
      if (!body.ok) {
        setError(body.error ?? 'Failed to start planning session');
      } else if (body.session_key) {
        const session = { key: body.session_key, startedAt: new Date().toISOString() };
        setSessions(prev => [...prev, session]);
        setActiveKey(body.session_key!);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setStarting(false);
    }
  }, []);

  const killSession = useCallback((key: string) => {
    fetch(`/api/plan/kill/${key}`, { method: 'POST' }).catch(() => {});
    setSessions(prev => {
      const next = prev.filter(s => s.key !== key);
      setActiveKey(curr => {
        if (curr !== key) return curr;
        return next.length > 0 ? next[next.length - 1].key : null;
      });
      return next;
    });
  }, []);

  if (hydrating) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <Spinner size="medium" />
      </div>
    );
  }

  const hasSessions = sessions.length > 0;
  const activeSession = sessions.find(s => s.key === activeKey) ?? null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

      {/* ── Top bar: title/description OR tab strip ── */}
      {!hasSessions ? (
        <div style={{ padding: '24px 24px 0' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ds-text)', margin: '0 0 6px' }}>
            PM Planning
          </h1>
          <p style={{ color: 'var(--ds-text-subtle)', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px', maxWidth: 600 }}>
            Start a planning session to work with the PM persona. Claude will interview you about
            what you want to build, help you size the work, and create the right tickets — a bug,
            a task, or an epic with child tasks — directly on the board.
          </p>
        </div>
      ) : (
        /* ── Tab strip ── */
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: '1px solid var(--ds-border)',
          overflowX: 'auto',
          background: 'var(--ds-surface)',
        }}>
          {sessions.map(s => {
            const isActive = s.key === activeKey;
            const label = s.key.replace('PLAN-', '');
            const time = new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <div
                key={s.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  height: 40,
                  cursor: 'pointer',
                  flexShrink: 0,
                  borderBottom: isActive ? '2px solid var(--ds-border-selected)' : '2px solid transparent',
                  background: isActive ? 'var(--ds-surface-raised)' : 'transparent',
                  color: isActive ? 'var(--ds-text)' : 'var(--ds-text-subtle)',
                }}
                onClick={() => setActiveKey(s.key)}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: isActive ? 600 : 400 }}>
                  {label}
                </span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>{time}</span>
                {/* Kill button */}
                <button
                  onClick={e => { e.stopPropagation(); killSession(s.key); }}
                  title="Kill session"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--ds-text-subtlest)',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: '2px 4px',
                    borderRadius: 3,
                    marginLeft: 2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--ds-text-danger)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--ds-text-subtlest)')}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
          <SectionMessage appearance="error" title="Could not start session">
            <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{error}</p>
            {error.includes('tmux') && (
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                Install tmux: <code>brew install tmux</code> (macOS) · <code>apt install tmux</code> (Linux)
              </p>
            )}
            {error.includes('claude CLI') && (
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                Install Claude Code:{' '}
                <a href="https://claude.ai/code" target="_blank" rel="noreferrer" style={{ color: 'var(--ds-link)' }}>
                  claude.ai/code
                </a>
              </p>
            )}
          </SectionMessage>
        </div>
      )}

      {/* ── Action bar ── */}
      <div style={{
        flexShrink: 0,
        padding: hasSessions ? '8px 16px' : '0 24px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderBottom: hasSessions ? '1px solid var(--ds-border)' : 'none',
      }}>
        <Button appearance="primary" onClick={startPlan} isDisabled={starting}>
          {starting ? 'Starting…' : hasSessions ? '+ New Plan' : 'Start New Plan'}
        </Button>
        {starting && <Spinner size="small" />}
      </div>

      {/* ── Terminal panel for the active tab ── */}
      {hasSessions ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '12px 24px 24px' }}>
          {activeSession && (
            <TerminalPanel
              key={activeSession.key}
              sessionKey={activeSession.key}
              onClose={() => killSession(activeSession.key)}
            />
          )}
        </div>
      ) : (
        /* ── Empty state ── */
        <div style={{ padding: '0 24px' }}>
          <div style={{
            padding: 20,
            background: 'var(--ds-surface-raised)',
            borderRadius: 8,
            border: '1px dashed var(--ds-border)',
            maxWidth: 480,
          }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-text-subtle)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--ds-text)' }}>How it works:</strong>
              <br />1. Click <em>Start New Plan</em> — Claude opens below
              <br />2. Answer the PM's interview questions in the terminal
              <br />3. Claude creates the right tickets (bug / task / epic) directly on your board
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
