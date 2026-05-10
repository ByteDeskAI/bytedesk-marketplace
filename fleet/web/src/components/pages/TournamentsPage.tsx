// TournamentsPage — Phase 12.8 (BDM-28, B14). Groups variant rows
// (BDM-99-v1, BDM-99-v2, …) into a tournament. Pulls state, cost,
// progress from the live session list. The actual judge call lands
// alongside the chain `judge` node + Haiku sidecar later — this page
// shows results once the parent ticket has a judge_summary file.
//
// Routes: #/tournaments (list parent groups) + #/tournaments/<parent>.

import { useMemo } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { Badge } from '../atoms/Badge';
import { useSessionList } from '../../hooks/useSessionList';
import { useSessionStats } from '../../hooks/useSessionStats';
import { useRoute } from '../../hooks/useRoute';
import type { SessionRow } from '../../api';

const VARIANT = /^([A-Z][A-Z0-9]+-\d+)-v(\d+)$/;

interface Group {
  parent: string;
  variants: SessionRow[];
}

export function TournamentsPage() {
  const sessions = useSessionList();
  const [route, navigate] = useRoute();
  const groups = useMemo(() => groupVariants(sessions.data ?? []), [sessions.data]);

  if (route.params.id) {
    const g = groups.find((x) => x.parent === route.params.id);
    return <TournamentDetail group={g} parent={route.params.id} onBack={() => navigate('/tournaments')} />;
  }

  return (
    <AppShell activeView="tournaments" topBarTitle="Tournaments">
      <header class="page-header">
        <h2 class="page-header__title">&gt; Tournaments</h2>
        <span class="page-header__sub">parent ticket · n variants · judge stub</span>
        <span class="page-header__spacer" />
        <span class="tape">{groups.length} GROUP{groups.length === 1 ? '' : 'S'}</span>
      </header>

      <h3 class="section-heading">
        ACTIVE BRACKETS
        <span class="section-heading__count">{groups.length}</span>
        <span class="section-heading__divider" />
      </h3>

      {groups.length === 0 ? (
        <div class="empty-state">
          <span class="empty-state__icon">⚙</span>
          NO TOURNAMENTS YET — SPAWN ONE FROM <strong>+ SPAWN</strong> → TOURNAMENT TAB
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
          {groups.map((g) => (
            <li
              key={g.parent}
              class="tournament-card"
              onClick={() => navigate(`/tournaments/${encodeURIComponent(g.parent)}`)}
            >
              <code style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{g.parent}</code>
              <span class="tape">{g.variants.length} VARIANTS</span>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'flex', gap: 'var(--space-1)' }}>
                {g.variants.map((v) => <Badge key={v.ticket} state={v.state} />)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function TournamentDetail({ group, parent, onBack }: { group: Group | undefined; parent: string; onBack: () => void }) {
  return (
    <AppShell activeView="tournaments" topBarTitle={`Tournament — ${parent}`}>
      <header class="page-header">
        <button type="button" class="link-button" onClick={onBack}>← ALL TOURNAMENTS</button>
        <h2 class="page-header__title">&gt; {parent}</h2>
        <span class="page-header__sub">bracket detail · {group ? `${group.variants.length} variants` : 'pending'}</span>
        <span class="page-header__spacer" />
        {group ? <span class="tape tape--accent">RUNNING</span> : <span class="tape tape--warn">SPAWNING</span>}
      </header>

      <h3 class="section-heading">
        VARIANT ROSTER
        <span class="section-heading__count">{group?.variants.length ?? 0}</span>
        <span class="section-heading__divider" />
      </h3>

      {!group ? (
        <div class="empty-state">
          <span class="empty-state__icon">…</span>
          NO VARIANTS YET — SPAWN MAY STILL BE IN PROGRESS
        </div>
      ) : (
        <table class="tournament-table">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Agent</th>
              <th>State</th>
              <th>Activity</th>
              <th>Cost</th>
              <th>Runtime</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {group.variants.map((v) => <VariantRow key={v.ticket} v={v} />)}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}

// VariantRow pulls live stats so the Agent column reflects the active
// sub-agent name (or — if the variant ran the default agent). Cost and
// progress fall back to the row-level summary while stats hydrate.
function VariantRow({ v }: { v: SessionRow }) {
  const { stats } = useSessionStats(v.ticket);
  const agent = stats?.agent_name || '—';
  const cost = stats?.cost_usd && stats.cost_usd > 0
    ? (stats.cost_usd < 1 ? `$${stats.cost_usd.toFixed(3)}` : `$${stats.cost_usd.toFixed(2)}`)
    : v.cost;
  return (
    <tr
      onClick={() => { window.location.hash = '/'; window.setTimeout(() => { (document.querySelector(`[data-ticket="${v.ticket}"]`) as HTMLElement | null)?.click(); }, 50); }}
      style={{ cursor: 'pointer' }}
    >
      <td><code style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{v.ticket}</code></td>
      <td>{agent === '—' ? <span style={{ color: 'var(--color-text-tertiary)' }}>—</span> : <code>{agent}</code>}</td>
      <td><Badge state={v.state} /></td>
      <td>{v.activity}</td>
      <td><span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{cost}</span></td>
      <td><span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{v.runtime}</span></td>
      <td><span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(v.progress * 100)}%</span></td>
    </tr>
  );
}

function groupVariants(rows: SessionRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const m = VARIANT.exec(r.ticket);
    if (!m) continue;
    const parent = m[1];
    if (!map.has(parent)) map.set(parent, { parent, variants: [] });
    map.get(parent)!.variants.push(r);
  }
  for (const g of map.values()) {
    g.variants.sort((a, b) => a.ticket.localeCompare(b.ticket, undefined, { numeric: true }));
  }
  return Array.from(map.values()).sort((a, b) => a.parent.localeCompare(b.parent));
}
