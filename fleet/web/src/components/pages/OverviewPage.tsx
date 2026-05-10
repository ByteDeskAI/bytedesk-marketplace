// OverviewPage — Container component. Composes the read-surface hooks
// and hands data to organisms. Phase 4 adds an inline SessionDetailPanel
// that slides in when the user clicks a row in the table.

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { StatRibbon } from '../organisms/StatRibbon';
import { SessionTable } from '../organisms/SessionTable';
import { SessionDetailPanel } from '../organisms/SessionDetailPanel';
import { useSessionList } from '../../hooks/useSessionList';
import { useStats } from '../../hooks/useStats';
import { fetchVersion } from '../../api';

export function OverviewPage() {
  const stats = useStats();
  const sessions = useSessionList();
  const [version, setVersion] = useState<{ build: string; project: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchVersion().then(setVersion);
  }, []);

  return (
    <AppShell
      activeView="overview"
      topBarTitle="Fleet Overview"
      onSpawnClick={() => alert('Spawn modal lands in Phase 6.')}
    >
      <div class={`overview${selected ? ' overview--with-detail' : ''}`}>
        <main class="overview__main">
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
            onRowClick={(r) => setSelected(r.ticket)}
          />

          {version ? (
            <footer style={{ marginTop: 32, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
              fleet-web {version.build} · project {version.project}
            </footer>
          ) : null}
        </main>

        {selected ? (
          <SessionDetailPanel ticket={selected} onClose={() => setSelected(null)} />
        ) : null}
      </div>
    </AppShell>
  );
}
