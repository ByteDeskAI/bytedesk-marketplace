import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import TextArea from '@atlaskit/textarea';
import TerminalPanel from './TerminalPanel';

interface Props {
  docId: string;
  docTitle: string;
  onClose: () => void;
  onDone: () => void;
}

const spring = { type: 'spring' as const, damping: 28, stiffness: 260 };

export default function DocGenerateModal({ docId, docTitle, onClose, onDone }: Props) {
  const [hint, setHint] = useState('');
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleGenerate() {
    setStarting(true);
    setError(null);
    try {
      const r = await fetch(`/api/docs/${docId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_hint: hint.trim() || undefined }),
      });
      const body = await r.json() as { ok: boolean; session_key?: string; error?: string };
      if (!body.ok) { setError(body.error ?? 'Failed to start generation'); return; }
      setSessionKey(body.session_key!);

      // Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`/api/docs/${docId}/generate/status`);
          const sb = await sr.json() as { ok: boolean; status: string };
          if (sb.ok && (sb.status === 'done' || sb.status === 'gone')) {
            if (pollRef.current) clearInterval(pollRef.current);
            onDone();
          }
        } catch {}
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setStarting(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(9,30,66,0.6)', zIndex: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}
      >
        <motion.div
          key="modal"
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={spring}
          onClick={e => e.stopPropagation()}
          style={{
            width: sessionKey ? 700 : 480,
            maxWidth: '100%',
            background: 'var(--ds-surface)',
            borderRadius: 8,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            transition: 'width 0.3s ease',
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ds-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ds-text)', flex: 1 }}>
              Generate with AI
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)' }}>{docId}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-subtle)', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}>×</button>
          </div>

          <div style={{ display: 'flex', minHeight: 0 }}>
            {/* Left pane — always visible */}
            <div style={{ width: sessionKey ? 280 : '100%', flexShrink: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, borderRight: sessionKey ? '1px solid var(--ds-border)' : 'none' }}>
              <div>
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--ds-text-subtle)', lineHeight: 1.6 }}>
                  Claude will read the codebase and generate content for{' '}
                  <strong style={{ color: 'var(--ds-text)' }}>{docTitle}</strong>.
                  The result will be saved automatically via <code style={{ fontSize: 11, fontFamily: 'monospace' }}>pm_doc_update</code>.
                </p>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ds-text)', marginBottom: 4 }}>
                  Additional context <span style={{ color: 'var(--ds-text-subtlest)', fontWeight: 400 }}>(optional)</span>
                </label>
                <TextArea
                  value={hint}
                  onChange={e => setHint(e.currentTarget.value)}
                  placeholder="e.g. Focus on the auth module. Keep it under 500 words."
                  minimumRows={4}
                  isDisabled={!!sessionKey}
                />
              </div>

              {error && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-text-danger)' }}>{error}</p>
              )}

              {!sessionKey ? (
                <Button appearance="primary" isDisabled={starting} onClick={handleGenerate}>
                  {starting ? <><Spinner size="small" /> Starting…</> : '✦ Generate'}
                </Button>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--ds-text-subtle)', lineHeight: 1.6 }}>
                  Claude is writing the content. The doc will update automatically when done.
                </div>
              )}
            </div>

            {/* Right pane — terminal (only when session running) */}
            {sessionKey && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0d1117', minHeight: 360 }}>
                <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 8, background: '#161b22', flexShrink: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ds-background-success-bold)', display: 'inline-block' }} />
                  <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600 }}>AI Session</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b949e' }}>{sessionKey}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <TerminalPanel sessionKey={sessionKey} onClose={onClose} />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
