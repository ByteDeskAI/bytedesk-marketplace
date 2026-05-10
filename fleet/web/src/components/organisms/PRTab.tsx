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

  if (err) return <div style={{ color: 'var(--color-state-error)' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--color-text-tertiary)' }}>Loading PR…</div>;
  if (!data.available) return <div style={{ color: 'var(--color-text-tertiary)' }}>{data.error ?? 'gh CLI not available'}</div>;
  if (data.error) return <div style={{ color: 'var(--color-text-tertiary)' }}>{data.error}</div>;

  const stateColor =
    data.state === 'OPEN'   ? 'var(--color-state-working)' :
    data.state === 'MERGED' ? 'var(--color-state-done)'    :
    data.state === 'CLOSED' ? 'var(--color-state-error)'   :
    'var(--color-text-secondary)';

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <strong style={{ fontSize: 'var(--text-lg)' }}>#{data.number}</strong>
        <span style={{ fontWeight: 600, color: stateColor }}>{data.state}</span>
        {data.url ? <a href={data.url} target="_blank" rel="noopener">view on github</a> : null}
      </div>
      <div style={{ fontSize: 'var(--text-md)' }}>{data.title}</div>
      <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>by {data.author}</div>

      {data.checks && data.checks.length > 0 ? (
        <div>
          <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Checks</h3>
          <ul class="pr-checks">
            {data.checks.map((c, i) => {
              const tone =
                c.conclusion === 'success' ? 'var(--color-state-done)' :
                c.conclusion === 'failure' ? 'var(--color-state-error)' :
                'var(--color-state-needs-input)';
              return (
                <li key={i}>
                  <span style={{ color: tone }}>● {c.conclusion || c.state}</span>
                  <span>{c.name}</span>
                  {c.workflow ? <span class="pr-checks__workflow">{c.workflow}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {data.files && data.files.length > 0 ? (
        <div>
          <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Files changed ({data.files.length})</h3>
          <ul class="pr-files">
            {data.files.slice(0, 50).map((f) => <li key={f}><code>{f}</code></li>)}
            {data.files.length > 50 ? <li style={{ color: 'var(--color-text-tertiary)' }}>… {data.files.length - 50} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
