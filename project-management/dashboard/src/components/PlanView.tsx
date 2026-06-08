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
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  // Restore any active planning sessions from the backend on mount
  useEffect(() => {
    fetch('/api/plan/sessions')
      .then(r => r.json() as Promise<{ ok: boolean; sessions: Array<{ key: string; startedAt: number }> }>)
      .then(body => {
        if (body.ok && body.sessions.length > 0) {
          setSessions(body.sessions.map(s => ({
            key: s.key,
            startedAt: new Date(s.startedAt * 1000).toISOString(),
          })));
        }
      })
      .catch(() => { /* network errors are silent — start fresh */ })
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
        setSessions(prev => [...prev, { key: body.session_key!, startedAt: new Date().toISOString() }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setStarting(false);
    }
  }, []);

  const removeSession = useCallback((key: string) => {
    setSessions(prev => prev.filter(s => s.key !== key));
  }, []);

  const hasSession = sessions.length > 0;

  if (hydrating) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <Spinner size="medium" />
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* ── Header strip ── always visible, compact when session is running ── */}
      <div style={{
        flexShrink: 0,
        padding: hasSession ? '12px 24px' : '24px',
        borderBottom: hasSession ? '1px solid var(--ds-border)' : 'none',
        display: 'flex',
        alignItems: hasSession ? 'center' : 'flex-start',
        flexDirection: hasSession ? 'row' : 'column',
        gap: hasSession ? 12 : 0,
      }}>
        {!hasSession && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ds-text)', margin: '0 0 6px' }}>
              PM Planning
            </h1>
            <p style={{
              color: 'var(--ds-text-subtle)', fontSize: 14, lineHeight: 1.7,
              margin: '0 0 20px', maxWidth: 600,
            }}>
              Start a planning session to work with the PM persona. Claude will interview you about
              what you want to build, help you size the work, and create the right tickets — a bug,
              a task, or an epic with child tasks — directly on the board.
            </p>
          </>
        )}

        {error && (
          <div style={{ marginBottom: hasSession ? 0 : 16, flex: hasSession ? 1 : undefined }}>
            <SectionMessage appearance="error" title="Could not start session">
              <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{error}</p>
              {error.includes('tmux') && (
                <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                  Install tmux: <code>brew install tmux</code> (macOS) · <code>apt install tmux</code> (Linux)
                </p>
              )}
              {error.includes('claude CLI') && (
                <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                  Install Claude Code: <a href="https://claude.ai/code" target="_blank" rel="noreferrer" style={{ color: 'var(--ds-link)' }}>claude.ai/code</a>
                </p>
              )}
            </SectionMessage>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button appearance="primary" onClick={startPlan} isDisabled={starting}>
            {starting ? 'Starting…' : hasSession ? '+ New Plan' : 'Start New Plan'}
          </Button>
          {starting && <Spinner size="small" />}
        </div>
      </div>

      {/* ── Active sessions — fill all remaining height ── */}
      {hasSession ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
          padding: '0 24px 24px',
          gap: 12,
        }}>
          {sessions.map((s, i) => (
            <div key={s.key} style={{
              flex: i === sessions.length - 1 ? 1 : undefined,
              // last session expands; earlier ones get a fixed height if multiple
              height: sessions.length > 1 && i < sessions.length - 1 ? 240 : undefined,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              paddingTop: 12,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 6, fontSize: 13, color: 'var(--ds-text-subtle)', flexShrink: 0,
              }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--ds-link)', fontWeight: 600 }}>{s.key}</span>
                <span>·</span>
                <span>Started {new Date(s.startedAt).toLocaleTimeString()}</span>
              </div>
              {/* TerminalPanel fills remaining space (no fixed height) */}
              <TerminalPanel sessionKey={s.key} onClose={() => removeSession(s.key)} />
            </div>
          ))}
        </div>
      ) : (
        /* ── Empty state ── */
        <div style={{ padding: '0 24px 24px' }}>
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
