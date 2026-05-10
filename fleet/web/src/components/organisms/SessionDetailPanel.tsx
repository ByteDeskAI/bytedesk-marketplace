// SessionDetailPanel — Phase 5 wires action buttons. Send opens a
// modal-textarea that POSTs /api/sessions/<TICKET>/send; Kill opens a
// confirm modal that POSTs /api/sessions/<TICKET>/kill (with safety
// branch on 409 / "UNCOMMITTED" — per BDM-13).

import { useEffect, useState } from 'preact/hooks';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { TerminalView } from './TerminalView';
import { InteractiveTerminal } from './InteractiveTerminal';
import { GitTab } from './GitTab';
import { PRTab } from './PRTab';
import { EventsTab } from './EventsTab';
import { SessionStatsTab } from './SessionStatsTab';
import { ThinkingPane } from './ThinkingPane';
import { useSessionStats } from '../../hooks/useSessionStats';
import { sendMessage, killSession, spawnReviewer, resumeSession, rebaseSession, type SessionRow } from '../../api';

// Trace appears conditionally (after Logs / before Events) when the
// transcript stream has produced thinking activity. The static array
// here is the full possible set in display order; the runtime list is
// filtered below.
const ALL_TABS = ['Overview', 'Stats', 'Terminal', 'Logs', 'Trace', 'Events', 'Git', 'PR'] as const;
type Tab = typeof ALL_TABS[number];

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

  // Live transcript stats — used to surface the permission-mode banner
  // and to gate the Trace tab on whether the session has produced any
  // thinking activity yet.
  const { stats, recentEvents } = useSessionStats(ticket);
  const showTrace =
    (stats?.thinking_chars ?? 0) > 0 ||
    recentEvents.some((e) => e.type === 'thinking');
  const tabs: readonly Tab[] = ALL_TABS.filter((t) => t !== 'Trace' || showTrace);
  // If Trace was visible and the user was on it, but the transcript
  // stream restarted and the cache cleared, snap back to Stats so we
  // don't render an inactive tab body.
  useEffect(() => {
    if (tab === 'Trace' && !showTrace) setTab('Stats');
  }, [tab, showTrace]);
  const permBanner =
    stats?.permission_mode === 'bypassPermissions'
      ? { kind: 'unsafe' as const, label: '⚠ unsafe permissions (bypassPermissions)' }
      : stats?.permission_mode === 'plan'
      ? { kind: 'plan' as const, label: '📋 plan mode' }
      : null;

  const topTools = stats?.tools
    ? Object.entries(stats.tools).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];
  const fmtCost = (n: number) => (n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);

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
          <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', fontSize: '10px' }}>SESSIONS ›</span>
          <strong style={{ fontFamily: 'var(--font-mono)', letterSpacing: 'var(--tracking-mono)' }}>{ticket}</strong>
          {data ? <span style={{ color: 'var(--color-text-secondary)' }}>{data.slug}</span> : null}
          {data ? <Badge state={data.state} /> : null}
        </div>
        <div class="detail-panel__actions">
          <Button onClick={() => setModal('send')}>Send Input</Button>
          <Button onClick={() => setModal('review')}>Spawn Reviewer</Button>
          <Button onClick={() => { window.location.hash = `/sessions/${encodeURIComponent(ticket)}/replay`; }}>
            Replay
          </Button>
          <Button
            onClick={async () => {
              try { await resumeSession(ticket); setActionMsg(`Resumed ${ticket}`); }
              catch (e) { setActionMsg((e as Error).message); }
              window.setTimeout(() => setActionMsg(null), 3000);
            }}
          >Resume</Button>
          <Button
            onClick={async () => {
              try { const r = await rebaseSession(ticket); setActionMsg(`Rebased ${ticket}: ${r.stdout.slice(0, 60)}`); }
              catch (e) { setActionMsg((e as Error).message); }
              window.setTimeout(() => setActionMsg(null), 4000);
            }}
          >Rebase</Button>
          <Button onClick={() => setModal('kill')}>Kill</Button>
          {onClose ? <Button onClick={onClose}>Close</Button> : null}
        </div>
        {actionMsg ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-mono)', color: 'var(--color-state-done)' }}>
            <span class="tape tape--ok" style={{ marginRight: 'var(--space-1)' }}>OK</span>
            {actionMsg}
          </div>
        ) : null}
        {(stats?.ai_title || (stats?.cost_usd ?? 0) > 0 || topTools.length > 0) ? (
          <div class="detail-panel__ribbon">
            {stats?.ai_title ? (
              <span class="detail-panel__title" title={stats.ai_title}>{stats.ai_title}</span>
            ) : null}
            {(stats?.cost_usd ?? 0) > 0 ? (
              <span class="detail-panel__chip" title="cost so far">{fmtCost(stats!.cost_usd)}</span>
            ) : null}
            {((stats?.tokens_in ?? 0) + (stats?.tokens_out ?? 0)) > 0 ? (
              <span class="detail-panel__chip" title="tokens in / out / cached">
                {stats!.tokens_in.toLocaleString()}↓ {stats!.tokens_out.toLocaleString()}↑
                {stats!.tokens_cache_hit > 0 ? ` (${stats!.tokens_cache_hit.toLocaleString()} cached)` : ''}
              </span>
            ) : null}
            {topTools.map(([name, n]) => (
              <span key={name} class="detail-panel__tool" title={`${n}× ${name}`}>{name}·{n}</span>
            ))}
            {(stats?.compactions ?? 0) > 0 ? (
              <span class="detail-panel__chip detail-panel__chip--compact" title={`${stats?.compactions} compactions`}>
                ↺ {stats?.compactions}
              </span>
            ) : null}
            {(stats?.api_errors ?? 0) > 0 ? (
              <span class="detail-panel__chip detail-panel__chip--error" title={`${stats?.api_errors} API errors`}>
                ⚠ {stats?.api_errors} api err
              </span>
            ) : null}
            {(stats?.queue_depth ?? 0) > 0 ? (
              <span class="detail-panel__chip" title="queued user messages">queue {stats?.queue_depth}</span>
            ) : null}
            {stats?.agent_name ? (
              <span class="detail-panel__chip" title="active sub-agent">@{stats.agent_name}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {permBanner ? (
        <div class={`perm-banner perm-banner--${permBanner.kind}`}>{permBanner.label}</div>
      ) : null}

      <nav class="detail-panel__tabs" role="tablist">
        {tabs.map((t) => (
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
          <div class="empty-state" style={{ borderColor: 'var(--color-state-error)', color: 'var(--color-state-error)' }}>
            <span class="tape tape--err" style={{ marginRight: 'var(--space-2)' }}>ERR</span>
            {error}
          </div>
        ) : tab === 'Overview' ? (
          <OverviewTab row={data} />
        ) : tab === 'Stats' ? (
          <SessionStatsTab ticket={ticket} />
        ) : tab === 'Terminal' ? (
          <InteractiveTerminal ticket={ticket} />
        ) : tab === 'Logs' ? (
          <TerminalView ticket={ticket} />
        ) : tab === 'Trace' ? (
          <ThinkingPane ticket={ticket} />
        ) : tab === 'Events' ? (
          <EventsTab ticket={ticket} />
        ) : tab === 'Git' ? (
          <GitTab ticket={ticket} />
        ) : (
          <PRTab ticket={ticket} />
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
        Spawns a child session at <code style={{ fontFamily: 'var(--font-mono)' }}>{ticket}-rev</code> with <code style={{ fontFamily: 'var(--font-mono)' }}>--parent {ticket}</code> and <code style={{ fontFamily: 'var(--font-mono)' }}>--full-auto</code>. The reviewer reads the parent's branch and posts a structured review.
      </p>
      <textarea
        class="modal__textarea"
        rows={5}
        value={prompt}
        onInput={(e) => setPrompt((e.currentTarget as HTMLTextAreaElement).value)}
        placeholder={`Optional review prompt — leave blank for the default (read branch/diff/PR for ${ticket}, post review).`}
      />
      {err ? (
        <div style={{ marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-state-error)' }}>
          <span class="tape tape--err" style={{ marginRight: 'var(--space-1)' }}>ERR</span>
          {err}
        </div>
      ) : null}
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
  if (!row) {
    return (
      <div class="empty-state">
        <span class="empty-state__icon">◌</span>
        Loading…
      </div>
    );
  }
  const conf = row.confidence ?? null;
  const drift = row.drift ?? null;
  return (
    <>
      {row.objective ? (
        <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderLeft: '2px solid var(--color-accent)', background: 'var(--color-bg-muted)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          <span class="field__label" style={{ display: 'block', marginBottom: '2px' }}>OBJECTIVE</span>
          <span style={{ color: 'var(--color-text-primary)' }}>{row.objective}</span>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <span class="auth-pill">DEPTH {row.depth ?? 0}</span>
        {row.full_auto ? <span class="auth-pill auth-pill--strong">--FULL-AUTO</span> : null}
        {row.parent ? <span class="auth-pill">PARENT {row.parent}</span> : null}
      </div>
      <dl class="detail-panel__meta">
        <dt>Branch</dt><dd><code style={{ fontFamily: 'var(--font-mono)' }}>{row.branch || '—'}</code></dd>
        <dt>Parent</dt><dd style={{ fontFamily: 'var(--font-mono)' }}>{row.parent || '—'}</dd>
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
                <div style={{ marginTop: 'var(--space-1)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-mono)', color: 'var(--color-state-error)' }}>
                  <span class="tape tape--err" style={{ marginRight: 'var(--space-1)' }}>WARN</span>
                  Agent has been quiet for a while — consider attaching to check on it.
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <div style={{ width: 80, height: 4, background: 'var(--color-bg-muted)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{pct}%</span>
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
      {err ? (
        <div style={{ marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-state-error)' }}>
          <span class="tape tape--err" style={{ marginRight: 'var(--space-1)' }}>ERR</span>
          {err}
        </div>
      ) : null}
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
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
        This stops the tmux session, removes the worktree, and deletes the branch.
      </p>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
        If the worktree has unpushed work, the kill will refuse — investigate before forcing (per <code style={{ fontFamily: 'var(--font-mono)' }}>BDM-13</code> safety).
      </p>
      {err ? (
        <div style={{ marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-state-error)' }}>
          <span class="tape tape--err" style={{ marginRight: 'var(--space-1)' }}>
            {uncommitted ? 'UNCOMMITTED' : 'ERR'}
          </span>
          {err}
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
