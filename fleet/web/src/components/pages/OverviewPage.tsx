// OverviewPage — the screenshot's panel 1. Phase 2 wires it against the
// placeholder fixtures in api.ts; Phase 3 swaps fetchStats / fetchSessions
// for real /api/* + SSE-driven hooks (useSessionList, useCostAggregate,
// etc.).

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { StatRibbon } from '../organisms/StatRibbon';
import { SessionTable } from '../organisms/SessionTable';
import { fetchSessions, fetchStats, fetchVersion, type FleetStats, type SessionRow } from '../../api';

export function OverviewPage() {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [version, setVersion] = useState<{ build: string; project: string } | null>(null);

  useEffect(() => {
    fetchStats().then(setStats);
    fetchSessions().then(setRows);
    fetchVersion().then(setVersion);
  }, []);

  return (
    <AppShell
      activeView="overview"
      topBarTitle="Fleet Overview"
      onSpawnClick={() => alert('Spawn modal lands in Phase 6.')}
    >
      {stats ? <StatRibbon stats={stats} /> : null}
      <SessionTable
        rows={rows}
        onRowClick={(r) => alert(`Detail view for ${r.ticket} lands in Phase 3.`)}
      />
      {version ? (
        <footer style={{ marginTop: 32, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
          fleet-web {version.build} · project {version.project}
        </footer>
      ) : null}
    </AppShell>
  );
}
