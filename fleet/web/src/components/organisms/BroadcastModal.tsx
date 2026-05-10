// BroadcastModal — Phase 7 (BDM-22 / B6). Sends one message to every
// active session. Server fans out to claude-sessions send per-ticket;
// the modal renders per-target results.

import { useState } from 'preact/hooks';
import { Button } from '../atoms/Button';
import { broadcast, type BroadcastResult } from '../../api';

export interface BroadcastModalProps {
  onClose: () => void;
}

export function BroadcastModal({ onClose }: BroadcastModalProps) {
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<BroadcastResult | null>(null);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <header class="modal__header">Broadcast input to all running sessions</header>
        <div class="modal__body">
          {results == null ? (
            <>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                The same message will be delivered to every session in <code>working</code>,
                {' '}<code>needs-input</code>, <code>reviewing</code>, or <code>starting</code>.
              </p>
              <textarea
                class="modal__textarea"
                rows={6}
                placeholder="Type the broadcast message…"
                value={msg}
                onInput={(e) => setMsg((e.currentTarget as HTMLTextAreaElement).value)}
                autoFocus
              />
              {err ? <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>{err}</div> : null}
              <div class="modal__actions">
                <Button onClick={onClose}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={!msg.trim() || submitting}
                  onClick={async () => {
                    setSubmitting(true);
                    setErr(null);
                    try {
                      const r = await broadcast(msg);
                      setResults(r);
                    } catch (e) {
                      setErr((e as Error).message);
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {submitting ? 'Broadcasting…' : 'Broadcast'}
                </Button>
              </div>
            </>
          ) : (
            <BroadcastResults result={results} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function BroadcastResults({ result, onClose }: { result: BroadcastResult; onClose: () => void }) {
  const ok = result.results.filter((r) => r.ok).length;
  const fail = result.results.length - ok;
  return (
    <>
      <div style={{ fontSize: 'var(--text-sm)' }}>
        Delivered to <strong>{ok}</strong> session{ok === 1 ? '' : 's'}{fail > 0 ? `, ${fail} failed` : ''}.
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4, maxHeight: 240, overflow: 'auto' }}>
        {result.results.map((r) => (
          <li
            key={r.ticket}
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: r.ok ? 'var(--color-state-done)' : 'var(--color-state-error)',
            }}
          >
            {r.ok ? '✓' : '✗'} {r.ticket}{r.error ? ` — ${r.error}` : ''}
          </li>
        ))}
      </ul>
      <div class="modal__actions">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
