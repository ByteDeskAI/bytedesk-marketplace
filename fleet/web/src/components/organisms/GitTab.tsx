// GitTab — Phase 12.2 (BDM-28, A22). Worktree status + last 5 commits.

import { useEffect, useState } from 'preact/hooks';
import { fetchGitStatus, type GitStatus } from '../../api';

export function GitTab({ ticket }: { ticket: string }) {
  const [data, setData] = useState<GitStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    fetchGitStatus(ticket).then(setData).catch((e) => setErr((e as Error).message));
    const id = window.setInterval(() => {
      fetchGitStatus(ticket).then(setData).catch(() => { /* swallow */ });
    }, 5000);
    return () => window.clearInterval(id);
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
  if (!data) {
    return (
      <div class="empty-state">
        <span class="empty-state__icon">◌</span>
        Loading git status…
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <dl class="detail-panel__meta">
        <dt>Worktree</dt><dd><code>{data.worktree}</code></dd>
        <dt>Branch</dt><dd><code>{data.branch || '—'}</code></dd>
        <dt>Status</dt>
        <dd>
          {data.clean ? (
            <span class="tape tape--ok">CLEAN</span>
          ) : (
            <span class="tape tape--warn">
              {data.files.length} CHANGE{data.files.length === 1 ? '' : 'S'}
            </span>
          )}
        </dd>
      </dl>

      {data.files.length > 0 ? (
        <div>
          <h3 class="section-heading">
            <span>WORKING TREE</span>
            <span class="section-heading__count">{data.files.length}</span>
          </h3>
          <ul class="git-files">
            {data.files.map((f) => (
              <li key={f.path}>
                <code class={`git-files__status git-files__status--${(f.status[0] || ' ').trim() || 'untracked'}`}>{f.status}</code>
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.log.length > 0 ? (
        <div>
          <h3 class="section-heading">
            <span>RECENT COMMITS</span>
            <span class="section-heading__count">{data.log.length}</span>
          </h3>
          <ul class="git-log">
            {data.log.map((e) => (
              <li key={e.hash}>
                <code class="git-log__hash">{e.hash}</code>
                <span class="git-log__subject">{e.subject}</span>
                <span class="git-log__when">{e.when} · {e.author}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
