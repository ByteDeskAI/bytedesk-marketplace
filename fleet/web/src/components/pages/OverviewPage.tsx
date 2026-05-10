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
import { fetchVersion, sweepMerged, cleanDeadMetas } from '../../api';

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

  // Live tab title (B2 + BDM-44): "Overview · 8/12 · 2 ⚠ · Fleet — <project>"
  // Leads with the page name so multi-tab operators can tell pages
  // apart (BDM-44 / WCAG 2.4.2). The live session counts stay so a
  // glance at the tab tells you what needs attention.
  useEffect(() => {
    const rows = sessions.data ?? [];
    const active = rows.filter((r) => ['starting', 'working', 'reviewing'].includes(r.state)).length;
    const needs = rows.filter((r) => ['needs-input', 'blocked', 'error'].includes(r.state)).length;
    const proj = version?.project ?? '';
    const parts = ['Overview'];
    if (rows.length > 0) parts.push(`${active}/${rows.length}`);
    if (needs > 0) parts.push(`${needs} ⚠`);
    parts.push('Fleet');
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
            <div class="empty-state" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)' }}>
              <span class="empty-state__icon">▸</span>
              Loading stats…
            </div>
          ) : null}

          {sessions.error ? (
            <div class="empty-state" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', color: 'var(--color-state-error)', borderColor: 'var(--color-state-error)' }}>
              <span class="tape tape--err">ERR</span>{' '}
              Couldn't load sessions: <code style={{ fontFamily: 'var(--font-mono)' }}>{sessions.error.message}</code>
            </div>
          ) : null}

          {showTree && sessions.data && sessions.data.length > 0 ? (
            <section style={{ marginBottom: 'var(--space-4)' }}>
              <h3 class="section-heading">
                &gt; Parent → child tree
                <span class="section-heading__count">{sessions.data.length}</span>
                <span class="section-heading__divider" />
              </h3>
              <TreeView rows={sessions.data} onRowClick={(r) => setSelected(r.ticket)} />
            </section>
          ) : null}

          <SessionTable
            rows={sessions.data ?? []}
            loading={sessions.loading && !sessions.data}
            density={density}
            onRowClick={(r) => setSelected(r.ticket)}
          />

          <footer
            style={{
              marginTop: 'var(--space-8)',
              paddingTop: 'var(--space-3)',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              letterSpacing: 'var(--tracking-mono)',
            }}
          >
            {version ? (
              <span>
                <span class="tape">FLEET-WEB</span>{' '}
                <code>{version.build}</code>
                <span style={{ margin: '0 var(--space-2)', color: 'var(--color-border-strong)' }}>·</span>
                <span class="tape">PROJECT</span>{' '}
                <code>{version.project}</code>
              </span>
            ) : null}
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
              onClick={async () => {
                try { const r = await sweepMerged(); setToast(`Swept: ${r.stdout.slice(0, 60)}`); }
                catch (e) { setToast((e as Error).message); }
                window.setTimeout(() => setToast(null), 4000);
              }}
              title="Sweep merged sessions"
            >
              Sweep
            </button>
            <button
              type="button"
              class="link-button"
              onClick={async () => {
                try { await cleanDeadMetas(); setToast('Cleaned dead metas'); }
                catch (e) { setToast((e as Error).message); }
                window.setTimeout(() => setToast(null), 3000);
              }}
              title="Clean dead session metadata"
            >
              Clean
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
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 'var(--space-4)',
            right: 'var(--space-4)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-state-done)',
            borderLeft: '3px solid var(--color-state-done)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            letterSpacing: 'var(--tracking-mono)',
            zIndex: 100,
          }}
        >
          <span class="tape tape--ok" style={{ marginRight: 'var(--space-2)' }}>OK</span>
          {toast}
        </div>
      ) : null}
    </AppShell>
  );
}
