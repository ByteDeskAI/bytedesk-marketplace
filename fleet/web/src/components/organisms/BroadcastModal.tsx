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
        <header class="modal__header">
          <span>BROADCAST INPUT</span>
          <span style={{ marginLeft: 'auto' }}>
            <span class="tape tape--warn">FAN-OUT · ALL ACTIVE</span>
          </span>
        </header>
        <div class="modal__body">
          {results == null ? (
            <>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
                padding: 'var(--space-2)',
                background: 'var(--color-bg-app)',
                borderLeft: '3px solid var(--color-accent)',
              }}>
                Targets:{' '}
                <span class="tape">working</span>{' '}
                <span class="tape">needs-input</span>{' '}
                <span class="tape">reviewing</span>{' '}
                <span class="tape">starting</span>
              </div>
              <textarea
                class="modal__textarea"
                rows={6}
                placeholder="Type the broadcast message…"
                value={msg}
                onInput={(e) => setMsg((e.currentTarget as HTMLTextAreaElement).value)}
                autoFocus
              />
              {err ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                }}>
                  <span class="tape tape--err">ERROR</span>
                  <span style={{ color: 'var(--color-state-error)' }}>{err}</span>
                </div>
              ) : null}
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        letterSpacing: 'var(--tracking-caps)',
        textTransform: 'uppercase',
      }}>
        <span class="tape tape--ok">OK · {ok}</span>
        {fail > 0 ? <span class="tape tape--err">FAIL · {fail}</span> : null}
        <span style={{ color: 'var(--color-text-tertiary)' }}>
          / {result.results.length} sessions
        </span>
      </div>
      <ul style={{
        listStyle: 'none', padding: 0, margin: 0,
        display: 'grid', gap: 0, maxHeight: 240, overflow: 'auto',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
      }}>
        {result.results.map((r) => (
          <li
            key={r.ticket}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 110px 1fr',
              gap: 'var(--space-3)',
              padding: '4px var(--space-3)',
              borderBottom: '1px solid var(--color-border-grid)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <span style={{
              fontWeight: 700,
              color: r.ok ? 'var(--color-state-done)' : 'var(--color-state-error)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-caps)',
            }}>
              {r.ok ? 'OK' : 'FAIL'}
            </span>
            <code style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{r.ticket}</code>
            <span style={{ color: r.ok ? 'var(--color-text-tertiary)' : 'var(--color-state-error)' }}>
              {r.error ?? (r.ok ? 'delivered' : '—')}
            </span>
          </li>
        ))}
      </ul>
      <div class="modal__actions">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}
