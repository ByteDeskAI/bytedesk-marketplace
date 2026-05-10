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
      <h2 style={{ margin: '0 0 16px', fontSize: 'var(--text-lg)', fontWeight: 600 }}>Tournaments</h2>
      {groups.length === 0 ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>
          No tournaments yet. Spawn one from the <strong>+ Spawn</strong> button → Tournament tab.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {groups.map((g) => (
            <li
              key={g.parent}
              class="tournament-card"
              onClick={() => navigate(`/tournaments/${encodeURIComponent(g.parent)}`)}
            >
              <strong>{g.parent}</strong>
              <span style={{ color: 'var(--color-text-secondary)' }}>{g.variants.length} variants</span>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'flex', gap: 4 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button type="button" class="link-button" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>{parent}</h2>
      </div>
      {!group ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>No variants yet — spawning may still be in progress.</div>
      ) : (
        <table class="tournament-table">
          <thead>
            <tr>
              <th>Variant</th>
              <th>State</th>
              <th>Activity</th>
              <th>Cost</th>
              <th>Runtime</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {group.variants.map((v) => (
              <tr
                key={v.ticket}
                onClick={() => { window.location.hash = '/'; window.setTimeout(() => { (document.querySelector(`[data-ticket="${v.ticket}"]`) as HTMLElement | null)?.click(); }, 50); }}
                style={{ cursor: 'pointer' }}
              >
                <td><strong>{v.ticket}</strong></td>
                <td><Badge state={v.state} /></td>
                <td>{v.activity}</td>
                <td>{v.cost}</td>
                <td>{v.runtime}</td>
                <td>{Math.round(v.progress * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
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
