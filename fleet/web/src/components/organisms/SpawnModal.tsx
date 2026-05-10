// SpawnModal — Phase 6 (BDM-21). Multi-tab modal for kicking off a new
// session. Manual tab is fully wired; "From Jira" + "From Backlog" are
// stubbed with a hint that the integrations land in a later phase.
//
// State machine: idle → submitting → success | error.

import { useState } from 'preact/hooks';
import { Button } from '../atoms/Button';
import { spawnFeature, type SpawnArgs } from '../../api';

const TABS = ['Manual', 'From Jira', 'From Backlog'] as const;
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
            <PlaceholderTab title="Spawn from Jira ticket" hint="Paste a ticket key (BDM-N); the modal will fetch summary/description and pre-fill the prompt. Lands with B7 in Phase 7." />
          ) : (
            <PlaceholderTab title="Spawn from backlog" hint="Pick from the project's open backlog as a list, optionally batch-spawn. Lands with B7 in Phase 7." />
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

function PlaceholderTab({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ display: 'grid', gap: 12, color: 'var(--color-text-secondary)' }}>
      <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</div>
      <div style={{ fontSize: 'var(--text-sm)' }}>{hint}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
        Use the <strong>Manual</strong> tab today; it produces an identical result to <code>spawn-claude-feature</code>.
      </div>
    </div>
  );
}
