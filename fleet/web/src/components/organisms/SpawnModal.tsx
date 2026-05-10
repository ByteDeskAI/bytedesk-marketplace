// SpawnModal — Phase 6 (BDM-21). Multi-tab modal for kicking off a new
// session. Manual tab is fully wired; "From Jira" + "From Backlog" are
// stubbed with a hint that the integrations land in a later phase.
//
// State machine: idle → submitting → success | error.

import { useEffect, useState } from 'preact/hooks';
import { Button } from '../atoms/Button';
import {
  spawnFeature, spawnTournament, fetchJiraIssue, fetchJiraBacklog, estimateCost,
  type SpawnArgs, type CostEstimate, type JiraBacklogItem,
} from '../../api';

const TABS = ['Manual', 'From Jira', 'From Backlog', 'Tournament'] as const;
type Tab = typeof TABS[number];

export interface SpawnModalProps {
  onClose: () => void;
  onSpawned?: (ticket: string) => void;
}

export function SpawnModal({ onClose, onSpawned }: SpawnModalProps) {
  const [tab, setTab] = useState<Tab>('Manual');
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <header class="modal__header">Spawn a new session</header>
        <nav class="modal__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              class={`modal__tab${t === tab ? ' modal__tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div class="modal__body">
          {tab === 'Manual' ? (
            <ManualTab onClose={onClose} onSpawned={onSpawned} />
          ) : tab === 'From Jira' ? (
            <FromJiraTab onClose={onClose} onSpawned={onSpawned} />
          ) : tab === 'From Backlog' ? (
            <FromBacklogTab onClose={onClose} onSpawned={onSpawned} />
          ) : (
            <TournamentTab onClose={onClose} onSpawned={onSpawned} />
          )}
        </div>
      </div>
    </div>
  );
}

function ManualTab({ onClose, onSpawned }: { onClose: () => void; onSpawned?: (ticket: string) => void }) {
  const [args, setArgs] = useState<SpawnArgs>({
    ticket: '',
    slug: '',
    prompt: '',
    full_auto: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);

  // Debounced cost estimate (B12). 400ms after the user stops typing
  // we ask the server for a low/high. Cancellation is implicit because
  // we only render the *latest* estimate.
  useEffect(() => {
    if (!args.prompt.trim()) { setEstimate(null); return; }
    let cancel = false;
    const id = window.setTimeout(async () => {
      try {
        const r = await estimateCost(args.prompt, !!args.full_auto);
        if (!cancel) setEstimate(r);
      } catch { /* swallow — estimate is advisory */ }
    }, 400);
    return () => { cancel = true; window.clearTimeout(id); };
  }, [args.prompt, args.full_auto]);

  const valid =
    /^[A-Z][A-Z0-9]+-\d+$/.test(args.ticket.trim()) &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(args.slug.trim()) &&
    args.prompt.trim().length > 0;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await spawnFeature({
        ticket: args.ticket.trim(),
        slug: args.slug.trim(),
        prompt: args.prompt,
        full_auto: args.full_auto,
        parent: args.parent?.trim() || undefined,
        max_depth: args.max_depth || undefined,
      });
      onSpawned?.(r.ticket);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      class="spawn-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !submitting) submit();
      }}
    >
      <div class="spawn-form__row">
        <label>
          <span class="spawn-form__label">Ticket</span>
          <input
            class="spawn-form__input"
            type="text"
            placeholder="BDM-99"
            value={args.ticket}
            onInput={(e) => setArgs({ ...args, ticket: (e.currentTarget as HTMLInputElement).value })}
            autoFocus
          />
        </label>
        <label>
          <span class="spawn-form__label">Slug</span>
          <input
            class="spawn-form__input"
            type="text"
            placeholder="fix-login-redirect"
            value={args.slug}
            onInput={(e) => setArgs({ ...args, slug: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
      </div>
      <label>
        <span class="spawn-form__label">Prompt</span>
        <textarea
          class="spawn-form__textarea"
          rows={8}
          placeholder="Describe what the agent should do…"
          value={args.prompt}
          onInput={(e) => setArgs({ ...args, prompt: (e.currentTarget as HTMLTextAreaElement).value })}
        />
      </label>
      <div class="spawn-form__row">
        <label>
          <span class="spawn-form__label">Parent (optional)</span>
          <input
            class="spawn-form__input"
            type="text"
            placeholder="BDM-14"
            value={args.parent ?? ''}
            onInput={(e) => setArgs({ ...args, parent: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label>
          <span class="spawn-form__label">Max depth</span>
          <input
            class="spawn-form__input"
            type="number"
            min={0}
            max={5}
            value={args.max_depth ?? ''}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              setArgs({ ...args, max_depth: v ? Number(v) : undefined });
            }}
          />
        </label>
      </div>
      <label class="spawn-form__check">
        <input
          type="checkbox"
          checked={!!args.full_auto}
          onChange={(e) => setArgs({ ...args, full_auto: (e.currentTarget as HTMLInputElement).checked })}
        />
        <span>--full-auto (skip per-step permission gate; recommended for autonomous runs)</span>
      </label>

      {estimate ? (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
          Estimated cost: <strong>${estimate.low.toFixed(2)}</strong> – <strong>${estimate.high.toFixed(2)}</strong>{' '}
          <span style={{ color: 'var(--color-text-tertiary)' }}>(heuristic; Haiku-judged estimate lands later)</span>
        </div>
      ) : null}

      {err ? <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>{err}</div> : null}

      <div class="modal__actions">
        <Button onClick={onClose} type="button">Cancel</Button>
        <Button variant="primary" disabled={!valid || submitting} type="submit">
          {submitting ? 'Spawning…' : 'Spawn'}
        </Button>
      </div>
    </form>
  );
}

// FromJiraTab — Phase 12.4 (A15). Paste a ticket key, fetch summary +
// description, pre-fill a Manual-shaped form.
function FromJiraTab({ onClose, onSpawned }: { onClose: () => void; onSpawned?: (t: string) => void }) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [args, setArgs] = useState<SpawnArgs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function fetchTicket() {
    setLoading(true); setErr(null);
    try {
      const issue = await fetchJiraIssue(key.trim());
      setArgs({
        ticket: issue.key,
        slug: slugify(issue.summary),
        prompt: `${issue.summary}\n\n${issue.description}`.trim(),
        full_auto: true,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!args) return;
    setSubmitting(true); setErr(null);
    try {
      const r = await spawnFeature(args);
      onSpawned?.(r.ticket);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input class="spawn-form__input" type="text" placeholder="BDM-99" value={key}
          onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} style={{ flex: 1 }} />
        <Button onClick={fetchTicket} disabled={!key.trim() || loading}>
          {loading ? 'Fetching…' : 'Fetch'}
        </Button>
      </div>
      {err ? <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>{err}</div> : null}
      {args ? (
        <>
          <div class="spawn-form__row">
            <label><span class="spawn-form__label">Ticket</span>
              <input class="spawn-form__input" value={args.ticket} readOnly /></label>
            <label><span class="spawn-form__label">Slug</span>
              <input class="spawn-form__input" value={args.slug}
                onInput={(e) => setArgs({ ...args, slug: (e.currentTarget as HTMLInputElement).value })} /></label>
          </div>
          <label><span class="spawn-form__label">Prompt (pre-filled — edit before spawning)</span>
            <textarea class="spawn-form__textarea" rows={10} value={args.prompt}
              onInput={(e) => setArgs({ ...args, prompt: (e.currentTarget as HTMLTextAreaElement).value })} /></label>
          <div class="modal__actions">
            <Button onClick={onClose} type="button">Cancel</Button>
            <Button variant="primary" disabled={submitting} onClick={submit}>
              {submitting ? 'Spawning…' : 'Spawn'}
            </Button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          Configure <code>[jira]</code> in Settings → Jira first.
        </div>
      )}
    </div>
  );
}

// FromBacklogTab — Phase 12.4 (B7). Lists open issues from JQL; user
// picks one (or many — batch-spawn TBD) to spawn.
function FromBacklogTab({ onClose, onSpawned }: { onClose: () => void; onSpawned?: (t: string) => void }) {
  const [items, setItems] = useState<JiraBacklogItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchJiraBacklog().then(setItems).catch((e) => setErr((e as Error).message));
  }, []);

  async function spawnFrom(item: JiraBacklogItem) {
    try {
      const issue = await fetchJiraIssue(item.key);
      const r = await spawnFeature({
        ticket: issue.key,
        slug: slugify(issue.summary),
        prompt: `${issue.summary}\n\n${issue.description}`.trim(),
        full_auto: true,
      });
      onSpawned?.(r.ticket);
      onClose();
    } catch (e) { setErr((e as Error).message); }
  }

  if (err) return <div style={{ color: 'var(--color-state-error)' }}>{err}</div>;
  if (!items) return <div style={{ color: 'var(--color-text-tertiary)' }}>Loading backlog…</div>;
  if (items.length === 0) return <div style={{ color: 'var(--color-text-tertiary)' }}>No open issues match the configured JQL.</div>;

  return (
    <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
      {items.map((it) => (
        <div key={it.key} style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: 8,
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
        }}>
          <strong>{it.key}</strong>
          <span style={{ flex: 1 }}>{it.summary}</span>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>{it.status}</span>
          <Button onClick={() => spawnFrom(it)}>Spawn</Button>
        </div>
      ))}
    </div>
  );
}

// TournamentTab — Phase 12.4 (A17). Spawn N variants of a parent ticket.
function TournamentTab({ onClose, onSpawned }: { onClose: () => void; onSpawned?: (t: string) => void }) {
  const [args, setArgs] = useState({ ticket: '', slug: '', prompt: '', n: 3, judge_prompt: '' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid =
    /^[A-Z][A-Z0-9]+-\d+$/.test(args.ticket.trim()) &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(args.slug.trim()) &&
    args.prompt.trim().length > 0 &&
    args.n >= 2 && args.n <= 6;

  async function submit() {
    setSubmitting(true); setErr(null);
    try {
      const r = await spawnTournament(args);
      onSpawned?.(r.parent);
      onClose();
    } catch (e) { setErr((e as Error).message); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div class="spawn-form__row">
        <label><span class="spawn-form__label">Parent ticket</span>
          <input class="spawn-form__input" placeholder="BDM-99" value={args.ticket}
            onInput={(e) => setArgs({ ...args, ticket: (e.currentTarget as HTMLInputElement).value })} /></label>
        <label><span class="spawn-form__label">Base slug</span>
          <input class="spawn-form__input" placeholder="fix-foo" value={args.slug}
            onInput={(e) => setArgs({ ...args, slug: (e.currentTarget as HTMLInputElement).value })} /></label>
      </div>
      <label><span class="spawn-form__label">Prompt (shared by every variant)</span>
        <textarea class="spawn-form__textarea" rows={6} value={args.prompt}
          onInput={(e) => setArgs({ ...args, prompt: (e.currentTarget as HTMLTextAreaElement).value })} /></label>
      <div class="spawn-form__row">
        <label><span class="spawn-form__label">N variants (2–6)</span>
          <input type="number" class="spawn-form__input" min={2} max={6} value={args.n}
            onInput={(e) => setArgs({ ...args, n: Number((e.currentTarget as HTMLInputElement).value || 3) })} /></label>
        <label><span class="spawn-form__label">Judge rubric (optional)</span>
          <input class="spawn-form__input" placeholder="grade 1-5 on …" value={args.judge_prompt}
            onInput={(e) => setArgs({ ...args, judge_prompt: (e.currentTarget as HTMLInputElement).value })} /></label>
      </div>
      {err ? <div style={{ color: 'var(--color-state-error)', fontSize: 'var(--text-xs)' }}>{err}</div> : null}
      <div class="modal__actions">
        <Button onClick={onClose} type="button">Cancel</Button>
        <Button variant="primary" disabled={!valid || submitting} onClick={submit}>
          {submitting ? 'Spawning…' : `Spawn ${args.n} variants`}
        </Button>
      </div>
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'work';
}
