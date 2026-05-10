// OverviewPage — Container component. Composes the read-surface hooks and
// hands data to organisms (Container/Presenter pattern). Per the BDM-14
// plan: "page components are thin containers that compose hooks +
// organisms; organisms receive data via props and dispatch actions via
// callbacks."

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { StatRibbon } from '../organisms/StatRibbon';
import { SessionTable } from '../organisms/SessionTable';
import { useSessionList } from '../../hooks/useSessionList';
import { useStats } from '../../hooks/useStats';
import { fetchVersion } from '../../api';

export function OverviewPage() {
  const stats = useStats();
  const sessions = useSessionList();
  const [version, setVersion] = useState<{ build: string; project: string } | null>(null);

  useEffect(() => {
    fetchVersion().then(setVersion);
  }, []);

  return (
    <AppShell
      activeView="overview"
      topBarTitle="Fleet Overview"
      onSpawnClick={() => alert('Spawn modal lands in Phase 6.')}
    >
      {stats.data ? (
        <StatRibbon stats={stats.data} />
      ) : stats.loading ? (
        <div style={{ marginBottom: 24, color: 'var(--color-text-tertiary)' }}>Loading stats…</div>
      ) : null}

      {sessions.error ? (
        <div style={{ marginBottom: 16, color: 'var(--color-state-error)' }}>
          Couldn't load sessions: {sessions.error.message}
        </div>
      ) : null}

      <SessionTable
        rows={sessions.data ?? []}
        loading={sessions.loading && !sessions.data}
        onRowClick={(r) => alert(`Detail view for ${r.ticket} lands in Phase 3c.`)}
      />

      {version ? (
        <footer style={{ marginTop: 32, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
          fleet-web {version.build} · project {version.project}
        </footer>
      ) : null}
    </AppShell>
  );
}
