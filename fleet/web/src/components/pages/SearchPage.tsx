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

  return (
    <AppShell activeView="search" topBarTitle="Search">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>Full-text log search</h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          {hits ? `${hits.length} hits` : busy ? 'searching…' : ''}
        </span>
        <div style={{ width: 320 }}>
          <SearchField placeholder="Match across every session log…" initial={q} onChange={setQ} />
        </div>
      </div>

      {err ? <div style={{ color: 'var(--color-state-error)' }}>{err}</div> : null}

      {!q.trim() ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>
          Type a substring. Search walks every <code>sessions/*/log</code> file in this project.
          Case-insensitive. Up to 200 hits.
        </div>
      ) : hits == null ? null : hits.length === 0 ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>No matches.</div>
      ) : (
        <ul class="search-hits">
          {hits.map((h, i) => (
            <li key={i} class="search-hit">
              <header class="search-hit__header">
                <strong>{h.ticket}</strong>
                <span class="search-hit__line">line {h.line_no}</span>
                <button
                  type="button"
                  class="link-button"
                  onClick={() => { window.location.hash = `/sessions/${encodeURIComponent(h.ticket)}/replay`; }}
                >open replay</button>
              </header>
              <pre class="search-hit__body">
                {h.before ? <span class="search-hit__ctx">{h.before}{'\n'}</span> : null}
                <span class="search-hit__match">{h.line}</span>
                {h.after ? <span class="search-hit__ctx">{'\n'}{h.after}</span> : null}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
