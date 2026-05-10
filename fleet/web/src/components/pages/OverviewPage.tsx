// OverviewPage — Container component. Composes the read-surface hooks
// and hands data to organisms. Phase 7 (BDM-22) adds: density toggle,
// shortcuts overlay, broadcast modal, live tab-title, persistent prefs.

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { StatRibbon } from '../organisms/StatRibbon';
import { SessionTable } from '../organisms/SessionTable';
import { SessionDetailPanel } from '../organisms/SessionDetailPanel';
import { SpawnModal } from '../organisms/SpawnModal';
import { BroadcastModal } from '../organisms/BroadcastModal';
import { TreeView } from '../organisms/TreeView';
import { ShortcutsOverlay } from '../molecules/ShortcutsOverlay';
import { useSessionList } from '../../hooks/useSessionList';
import { useStats } from '../../hooks/useStats';
import { useShortcuts } from '../../hooks/useShortcuts';
import { usePersistentState } from '../../hooks/usePersistentState';
import { fetchVersion } from '../../api';

type Density = 'comfortable' | 'compact';

export function OverviewPage() {
  const stats = useStats();
  const sessions = useSessionList();
  const [version, setVersion] = useState<{ build: string; project: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [density, setDensity] = usePersistentState<Density>('fleet.density', 'comfortable');
  const [showTree, setShowTree] = usePersistentState<boolean>('fleet.showTree', false);

  useEffect(() => {
    fetchVersion().then(setVersion);
  }, []);

  // Live tab title (B2): "Fleet · 8/12 · 2 ⚠ — <project>"
  useEffect(() => {
    const rows = sessions.data ?? [];
    const active = rows.filter((r) => ['starting', 'working', 'reviewing'].includes(r.state)).length;
    const needs = rows.filter((r) => ['needs-input', 'blocked', 'error'].includes(r.state)).length;
    const proj = version?.project ?? '';
    const parts = [`Fleet`];
    if (rows.length > 0) parts.push(`${active}/${rows.length}`);
    if (needs > 0) parts.push(`${needs} ⚠`);
    document.title = parts.join(' · ') + (proj ? ` — ${proj}` : '');
  }, [sessions.data, version?.project]);

  useShortcuts({
    onHelp: () => setShortcutsOpen((v) => !v),
    onFocusSearch: () => {
      const el = document.querySelector<HTMLInputElement>('.search-field input');
      el?.focus();
    },
    onToggleDensity: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
    onSpawn: () => setSpawnOpen(true),
    onBroadcast: () => setBroadcastOpen(true),
    onEscape: () => {
      if (spawnOpen) setSpawnOpen(false);
      else if (broadcastOpen) setBroadcastOpen(false);
      else if (shortcutsOpen) setShortcutsOpen(false);
      else if (selected) setSelected(null);
    },
  });

  return (
    <AppShell
      activeView="overview"
      topBarTitle="Fleet Overview"
      onSpawnClick={() => setSpawnOpen(true)}
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

          {showTree && sessions.data && sessions.data.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                Parent → child tree
              </h3>
              <TreeView rows={sessions.data} onRowClick={(r) => setSelected(r.ticket)} />
            </div>
          ) : null}

          <SessionTable
            rows={sessions.data ?? []}
            loading={sessions.loading && !sessions.data}
            density={density}
            onRowClick={(r) => setSelected(r.ticket)}
          />

          <footer
            style={{
              marginTop: 32,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {version ? <span>fleet-web {version.build} · project {version.project}</span> : null}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              class="link-button"
              onClick={() => setBroadcastOpen(true)}
              title="Broadcast input (b)"
            >
              Broadcast
            </button>
            <button
              type="button"
              class="link-button"
              onClick={() => setShowTree(!showTree)}
              title="Toggle parent → child tree view"
            >
              {showTree ? 'Hide tree' : 'Show tree'}
            </button>
            <button
              type="button"
              class="link-button"
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
              title="Toggle density (d)"
            >
              {density === 'compact' ? 'Comfortable' : 'Compact'}
            </button>
            <button
              type="button"
              class="link-button"
              onClick={() => setShortcutsOpen(true)}
              title="Shortcuts (?)"
            >
              ? Shortcuts
            </button>
          </footer>
        </main>

        {selected ? (
          <SessionDetailPanel ticket={selected} onClose={() => setSelected(null)} />
        ) : null}
      </div>

      {spawnOpen ? (
        <SpawnModal
          onClose={() => setSpawnOpen(false)}
          onSpawned={(t) => {
            setToast(`Spawned ${t}`);
            window.setTimeout(() => setToast(null), 4000);
          }}
        />
      ) : null}

      {broadcastOpen ? <BroadcastModal onClose={() => setBroadcastOpen(false)} /> : null}
      {shortcutsOpen ? <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} /> : null}

      {toast ? (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            padding: '10px 16px',
            background: 'var(--color-state-done)',
            color: '#fff',
            borderRadius: 6,
            fontSize: 'var(--text-sm)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 100,
          }}
        >
          {toast}
        </div>
      ) : null}
    </AppShell>
  );
}
