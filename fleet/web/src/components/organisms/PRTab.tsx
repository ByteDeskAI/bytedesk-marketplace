// PRTab — Phase 12.2 (BDM-28, A21). Wraps `gh pr view` + `gh pr checks`.

import { useEffect, useState } from 'preact/hooks';
import { fetchPRStatus, type PRStatus } from '../../api';

export function PRTab({ ticket }: { ticket: string }) {
  const [data, setData] = useState<PRStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    fetchPRStatus(ticket).then(setData).catch((e) => setErr((e as Error).message));
  }, [ticket]);

  if (err) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
      }}>
        <span class="tape tape--err">ERROR</span>
        <span style={{ color: 'var(--color-state-error)' }}>{err}</span>
      </div>
    );
  }
  if (!data) return <div class="empty-state"><span class="empty-state__icon">◌</span>Loading PR…</div>;
  if (!data.available) return <div class="empty-state"><span class="empty-state__icon">▢</span>{data.error ?? 'gh CLI not available'}</div>;
  if (data.error) return <div class="empty-state"><span class="empty-state__icon">▢</span>{data.error}</div>;

  const stateTape =
    data.state === 'OPEN'   ? 'tape' :
    data.state === 'MERGED' ? 'tape tape--ok' :
    data.state === 'CLOSED' ? 'tape tape--err' :
    'tape';

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {/* Header strip — number / state / external link */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--color-bg-app)',
        border: '1px solid var(--color-border)',
        fontFamily: 'var(--font-mono)',
      }}>
        <span style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          letterSpacing: 'var(--tracking-mono)',
        }}>
          PR #{data.number}
        </span>
        <span class={stateTape}>{data.state}</span>
        <span style={{ flex: 1 }} />
        {data.url ? (
          <a href={data.url} target="_blank" rel="noopener" style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            letterSpacing: 'var(--tracking-caps)',
            textTransform: 'uppercase',
          }}>
            view on github →
          </a>
        ) : null}
      </div>

      {/* Title + meta — dense rows */}
      <dl class="detail-panel__meta">
        <dt>Title</dt><dd>{data.title}</dd>
        <dt>Author</dt><dd>@{data.author}</dd>
      </dl>

      {data.checks && data.checks.length > 0 ? (
        <div>
          <h3 class="section-heading">
            <span>CHECKS</span>
            <span class="section-heading__count">{data.checks.length}</span>
          </h3>
          <ul class="pr-checks">
            {data.checks.map((c, i) => {
              const cls =
                c.conclusion === 'success' ? 'tape tape--ok' :
                c.conclusion === 'failure' ? 'tape tape--err' :
                'tape tape--warn';
              return (
                <li key={i}>
                  <span class={cls}>{c.conclusion || c.state}</span>
                  <span style={{ color: 'var(--color-text-primary)' }}>{c.name}</span>
                  {c.workflow ? <span class="pr-checks__workflow">{c.workflow}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {data.files && data.files.length > 0 ? (
        <div>
          <h3 class="section-heading">
            <span>FILES CHANGED</span>
            <span class="section-heading__count">{data.files.length}</span>
          </h3>
          <ul class="pr-files">
            {data.files.slice(0, 50).map((f) => <li key={f}><code>{f}</code></li>)}
            {data.files.length > 50 ? (
              <li style={{ color: 'var(--color-text-tertiary)' }}>
                … {data.files.length - 50} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
