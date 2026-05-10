// SearchPage — Phase 12.5 (BDM-28, C1). Full-text search across all
// session logs. URL: #/search?q=<term>

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { SearchField } from '../molecules/SearchField';

interface Hit {
  ticket: string;
  line_no: number;
  line: string;
  before?: string;
  after?: string;
}

export function SearchPage() {
  const [q, setQ] = useState(() => {
    const m = /[?&]q=([^&]+)/.exec(window.location.hash);
    return m ? decodeURIComponent(m[1]) : '';
  });
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    let cancel = false;
    setBusy(true);
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=200`);
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const data = await r.json();
        if (!cancel) setHits(data);
      } catch (e) {
        if (!cancel) setErr((e as Error).message);
      } finally {
        if (!cancel) setBusy(false);
      }
    }, 300);
    return () => { cancel = true; window.clearTimeout(id); };
  }, [q]);

  const status = hits ? `${hits.length} hits` : busy ? 'searching…' : '';

  return (
    <AppShell activeView="search" topBarTitle="Search">
      <header class="page-header">
        <h2 class="page-header__title">grep</h2>
        <span class="page-header__sub">full-text · case-insensitive · max 200</span>
        <span class={`tape ${busy ? 'tape--warn' : (hits && hits.length > 0 ? 'tape--ok' : '')}`}>
          {busy ? 'SCAN' : (hits == null ? 'IDLE' : hits.length === 0 ? 'EMPTY' : 'HITS')}
        </span>
        <span class="page-header__sub">{status}</span>
        <span class="page-header__spacer" />
        <div style={{ width: 320 }}>
          <SearchField placeholder="Match across every session log…" initial={q} onChange={setQ} />
        </div>
      </header>

      <pre class="code-block" aria-label="grep command preview">
        {`grep -irn ${q.trim() ? JSON.stringify(q.trim()) : '<pattern>'} ~/.claude-sessions/*/log`}
      </pre>

      {err ? (
        <div class="empty-state" style={{ color: 'var(--color-state-error)', marginTop: 'var(--space-3)' }}>
          <span class="empty-state__icon" aria-hidden>!</span>
          {err}
        </div>
      ) : null}

      {!q.trim() ? (
        <div class="empty-state" style={{ marginTop: 'var(--space-3)' }}>
          <span class="empty-state__icon" aria-hidden>/</span>
          Type a substring to grep every <code>sessions/*/log</code> file in this project.
        </div>
      ) : hits == null ? null : hits.length === 0 ? (
        <div class="empty-state" style={{ marginTop: 'var(--space-3)' }}>
          <span class="empty-state__icon" aria-hidden>∅</span>
          No matches.
        </div>
      ) : (
        <>
          <h3 class="section-heading" style={{ marginTop: 'var(--space-3)' }}>
            Matches
            <span class="section-heading__divider" />
            <span class="section-heading__count">{hits.length}</span>
          </h3>
          <ul class="search-hits">
            {hits.map((h, i) => (
              <li key={i} class="search-hit">
                <header class="search-hit__header">
                  <span style={{ color: 'var(--color-accent)' }}>&gt;</span>
                  <strong>{h.ticket}</strong>
                  <span class="search-hit__line">L{h.line_no}</span>
                  <span class="page-header__spacer" />
                  <button
                    type="button"
                    class="link-button"
                    onClick={() => { window.location.hash = `/sessions/${encodeURIComponent(h.ticket)}/replay`; }}
                  >open replay →</button>
                </header>
                <pre class="search-hit__body">
                  {h.before ? <span class="search-hit__ctx">{`${pad(h.line_no - 1)}  ${h.before}\n`}</span> : null}
                  <span class="search-hit__ctx">{pad(h.line_no) + '  '}</span>
                  <span class="search-hit__match">{h.line}</span>
                  {h.after ? <span class="search-hit__ctx">{`\n${pad(h.line_no + 1)}  ${h.after}`}</span> : null}
                </pre>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}

function pad(n: number): string {
  return String(n).padStart(5, ' ');
}
