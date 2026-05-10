// SessionDetailPanel — Phase 5 wires action buttons. Send opens a
// modal-textarea that POSTs /api/sessions/<TICKET>/send; Kill opens a
// confirm modal that POSTs /api/sessions/<TICKET>/kill (with safety
// branch on 409 / "UNCOMMITTED" — per BDM-13).

import { useEffect, useState } from 'preact/hooks';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { TerminalView } from './TerminalView';
import { sendMessage, killSession, spawnReviewer, type SessionRow } from '../../api';

const TABS = ['Overview', 'Logs'] as const;
type Tab = typeof TABS[number];

export interface SessionDetailPanelProps {
  ticket: string;
  onClose?: () => void;
  onKilled?: () => void;
}

export function SessionDetailPanel({ ticket, onClose, onKilled }: SessionDetailPanelProps) {
  const [data, setData] = useState<SessionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [modal, setModal] = useState<'send' | 'kill' | 'review' | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    const url = `/api/sessions/${encodeURIComponent(ticket)}`;
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
        .then(setData)
        .catch((e) => setError((e as Error).message));
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [ticket]);

  return (
    <aside class="detail-panel">
      <header class="detail-panel__header">
        <div class="detail-panel__crumbs">
          <span style={{ color: 'var(--color-text-tertiary)' }}>Sessions ›</span>
          <strong>{ticket}</strong>
          {data ? <span style={{ color: 'var(--color-text-secondary)' }}>{data.slug}</span> : null}
          {data ? <Badge state={data.state} /> : null}
        </div>
        <div class="detail-panel__actions">
          <Button onClick={() => setModal('send')}>Send Input</Button>
          <Button onClick={() => setModal('review')}>Spawn Reviewer</Button>
          <Button onClick={() => { window.location.hash = `/sessions/${encodeURIComponent(ticket)}/replay`; }}>
            Replay
          </Button>
          <Button onClick={() => setModal('kill')}>Kill</Button>
          {onClose ? <Button onClick={onClose}>Close</Button> : null}
        </div>
        {actionMsg ? (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-state-done)' }}>{actionMsg}</div>
        ) : null}
      </header>

      <nav class="detail-panel__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            class={`detail-panel__tab${t === tab ? ' detail-panel__tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <div class="detail-panel__body">
        {error ? (
          <div style={{ color: 'var(--color-state-error)' }}>{error}</div>
        ) : tab === 'Overview' ? (
          <OverviewTab row={data} />
        ) : (
          <TerminalView ticket={ticket} />
        )}
      </div>

      {modal === 'send' ? (
        <SendModal
          ticket={ticket}
          onClose={() => setModal(null)}
          onSent={(text) => {
            setModal(null);
            setActionMsg(`Sent: ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}`);
            window.setTimeout(() => setActionMsg(null), 3000);
          }}
        />
      ) : null}

      {modal === 'kill' ? (
        <KillModal
          ticket={ticket}
          onClose={() => setModal(null)}
          onKilled={() => {
            setModal(null);
            onKilled?.();
            onClose?.();
          }}
        />
      ) : null}

      {modal === 'review' ? (
        <ReviewModal
          ticket={ticket}
          onClose={() => setModal(null)}
          onSpawned={(child) => {
            setModal(null);
            setActionMsg(`Spawned reviewer ${child}`);
            window.setTimeout(() => setActionMsg(null), 4000);
          }}
        />
      ) : null}
    </aside>
  );
}

function ReviewModal({ ticket, onClose, onSpawned }: { ticket: string; onClose: () => void; onSpawned: (child: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Spawn reviewer for ${ticket}`} onClose={onClose}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
        Spawns a child session at <code>{ticket}-rev</code> with <code>--parent {ticket}</code> and <code>--full-auto</code>. The reviewer reads the parent's branch and posts a structured review.
      </p>
      <textarea
        class="modal__textarea"
        rows={5}
        value={prompt}
        onInput={(e) => setPrompt((e.currentTarget as HTMLTextAreaElement).value)}
        placeholder={`Optional review prompt — leave blank for the default (read branch/diff/PR for ${ticket}, post review).`}
      />
      {err ? <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>{err}</div> : null}
      <div class="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            setErr(null);
            try {
              const r = await spawnReviewer(ticket, prompt.trim() || undefined, true);
              onSpawned(r.ticket);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? 'Spawning…' : 'Spawn Reviewer'}
        </Button>
      </div>
    </Modal>
  );
}

function OverviewTab({ row }: { row: SessionRow | null }) {
  if (!row) return <div style={{ color: 'var(--color-text-tertiary)' }}>Loading…</div>;
  const conf = row.confidence ?? null;
  const drift = row.drift ?? null;
  return (
    <>
      {row.objective ? (
        <div style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Objective: </span>
          {row.objective}
        </div>
      ) : null}
      <dl class="detail-panel__meta">
        <dt>Branch</dt><dd><code>{row.branch || '—'}</code></dd>
        <dt>Parent</dt><dd>{row.parent || '—'}</dd>
        <dt>Activity</dt><dd>{row.activity}</dd>
        <dt>Cost</dt><dd>{row.cost}</dd>
        <dt>Runtime</dt><dd>{row.runtime}</dd>
        <dt>Progress</dt><dd>{Math.round(row.progress * 100)}%</dd>
        {conf != null ? (
          <>
            <dt>State confidence</dt>
            <dd>
              <ConfidenceBar value={conf} />
            </dd>
          </>
        ) : null}
        {drift != null && drift > 0.05 ? (
          <>
            <dt>Drift score</dt>
            <dd>
              <ConfidenceBar value={drift} tone="warn" />
              {drift > 0.6 ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-state-error)' }}>
                  ⚠ The agent has been quiet for a while — consider attaching to check on it.
                </div>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </>
  );
}

function ConfidenceBar({ value, tone = 'good' }: { value: number; tone?: 'good' | 'warn' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = tone === 'warn'
    ? 'var(--color-state-needs-input)'
    : 'var(--color-state-done)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, height: 6, background: 'var(--color-bg-muted)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{pct}%</span>
    </div>
  );
}

function SendModal({ ticket, onClose, onSent }: { ticket: string; onClose: () => void; onSent: (msg: string) => void }) {
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Send input to ${ticket}`} onClose={onClose}>
      <textarea
        class="modal__textarea"
        rows={5}
        value={msg}
        onInput={(e) => setMsg((e.currentTarget as HTMLTextAreaElement).value)}
        placeholder="Type a message; Enter sends, Shift+Enter for newline"
        autoFocus
      />
      {err ? <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>{err}</div> : null}
      <div class="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!msg.trim() || sending}
          onClick={async () => {
            setSending(true);
            setErr(null);
            try {
              await sendMessage(ticket, msg);
              onSent(msg);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </Modal>
  );
}

function KillModal({ ticket, onClose, onKilled }: { ticket: string; onClose: () => void; onKilled: () => void }) {
  const [killing, setKilling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uncommitted, setUncommitted] = useState(false);
  return (
    <Modal title={`Kill ${ticket}?`} onClose={onClose}>
      <p>This stops the tmux session, removes the worktree, and deletes the branch.</p>
      <p>If the worktree has unpushed work, the kill will refuse — investigate before forcing (per BDM-13 safety).</p>
      {err ? (
        <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>
          {uncommitted ? '⚠ Worktree has uncommitted changes. ' : ''}{err}
        </div>
      ) : null}
      <div class="modal__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={killing}
          onClick={async () => {
            setKilling(true);
            setErr(null);
            setUncommitted(false);
            try {
              await killSession(ticket);
              onKilled();
            } catch (e) {
              const msg = (e as Error).message;
              if (msg.startsWith('UNCOMMITTED:')) {
                setUncommitted(true);
                setErr(msg.replace(/^UNCOMMITTED:\s*/, ''));
              } else {
                setErr(msg);
              }
            } finally {
              setKilling(false);
            }
          }}
        >
          {killing ? 'Killing…' : 'Confirm Kill'}
        </Button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: preact.ComponentChildren }) {
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <header class="modal__header">{title}</header>
        <div class="modal__body">{children}</div>
      </div>
    </div>
  );
}
