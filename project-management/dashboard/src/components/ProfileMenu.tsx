import { useState } from 'react';
import Avatar from '@atlaskit/avatar';
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import MigrationWizard from './MigrationWizard';

type ActionState = 'idle' | 'restarting' | 'exiting' | 'done' | 'error';

export default function ProfileMenu() {
  const [state, setState] = useState<ActionState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showMigration, setShowMigration] = useState(false);

  async function handleExit() {
    setState('exiting');
    try {
      await fetch('/api/server/exit', { method: 'POST' });
    } catch {}
    // Server is shutting down — show "done" and let the page go blank naturally
    setState('done');
  }

  async function handleRestart() {
    setState('restarting');
    try {
      const res = await fetch('/api/server/restart', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Expected — server is restarting and connection drops
    }

    // Poll /health until the new server responds (up to 30s)
    const deadline = performance.now() + 30_000;
    let reachable = false;
    while (performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 800));
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (r.ok) { reachable = true; break; }
      } catch {}
    }

    if (reachable) {
      window.location.reload();
    } else {
      setState('error');
      setErrorMsg('Server did not come back within 30 s. Check the terminal.');
    }
  }

  // ── Overlay states ────────────────────────────────────────────────────────
  if (state === 'exiting' || state === 'done') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--ds-surface)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 20,
        animation: 'fadeIn .25s ease',
      }}>
        <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
        {state === 'exiting' ? (
          <>
            <Spinner size="large" />
            <p style={{ color: 'var(--ds-text-subtle)', fontSize: 14 }}>Shutting down…</p>
          </>
        ) : (
          <p style={{ color: 'var(--ds-text-subtlest)', fontSize: 14 }}>Dashboard stopped. Close this tab.</p>
        )}
      </div>
    );
  }

  if (state === 'restarting') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(7,12,26,.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 20,
        animation: 'fadeIn .2s ease',
      }}>
        <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
        <Spinner size="large" />
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--ds-text)', fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            Rebuilding dashboard…
          </p>
          <p style={{ color: 'var(--ds-text-subtle)', fontSize: 13 }}>
            Running <code style={{ fontFamily: 'monospace', color: 'var(--ds-link)' }}>npm run build</code> then restarting the server
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--ds-surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      }}>
        <SectionMessage appearance="error" title="Restart failed">
          <p>{errorMsg}</p>
          <button
            onClick={() => { setState('idle'); setErrorMsg(''); }}
            style={{ marginTop: 12, background: 'var(--ds-background-brand-bold)', color: '#fff', border: 'none', borderRadius: 3, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', lineHeight: 'inherit' }}
          >
            Dismiss
          </button>
        </SectionMessage>
      </div>
    );
  }

  // ── Normal state: dropdown trigger ────────────────────────────────────────
  return (
    <>
    {showMigration && <MigrationWizard onClose={() => setShowMigration(false)} />}
    <DropdownMenu
      trigger={({ triggerRef, ...triggerProps }) => (
        <button
          ref={triggerRef as React.Ref<HTMLButtonElement>}
          {...triggerProps}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, display: 'flex', alignItems: 'center',
          }}
          title="Dashboard options"
        >
          <Avatar size="small" name="PM" />
        </button>
      )}
      placement="bottom-end"
    >
      <DropdownItemGroup title="Data">
        <DropdownItem
          description="Migrate between SQLite and JSONL backends"
          onClick={() => setShowMigration(true)}
        >
          Migrate data store…
        </DropdownItem>
      </DropdownItemGroup>
      <DropdownItemGroup title="Dashboard">
        <DropdownItem
          description="Rebuild dist and restart the server"
          onClick={handleRestart}
        >
          Restart dashboard
        </DropdownItem>
        <DropdownItem
          description="Stop the dashboard server process"
          onClick={handleExit}
        >
          Exit dashboard
        </DropdownItem>
      </DropdownItemGroup>
    </DropdownMenu>
    </>
  );
}
