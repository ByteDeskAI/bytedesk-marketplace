// RulesPage — Phase 12.3 (BDM-28, A11). Lists pending rules from the
// per-project rules dir; lets the user cancel one.

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { Button } from '../atoms/Button';
import { listRules, deleteRule, type FleetRule } from '../../api';

export function RulesPage() {
  const [rules, setRules] = useState<FleetRule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => {
    listRules().then(setRules).catch((e) => setErr((e as Error).message));
  };
  useEffect(() => {
    reload();
    const id = window.setInterval(reload, 5000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <AppShell activeView="chains" topBarTitle="Pending rules">
      <h2 style={{ margin: '0 0 16px', fontSize: 'var(--text-lg)', fontWeight: 600 }}>Pending rules</h2>
      {err ? <div style={{ color: 'var(--color-state-error)' }}>{err}</div> : null}
      {!rules ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>Loading…</div>
      ) : rules.length === 0 ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>
          No pending rules. Rules are created by <code>/fleet:wait</code>, <code>/fleet:cleanup</code>, and chain runs.
        </div>
      ) : (
        <ul class="audit-list">
          {rules.map((r) => (
            <li key={r.id} class="audit-list__row" style={{ gridTemplateColumns: '180px 200px 1fr 90px' }}>
              <div class="audit-list__time">{new Date(r.created).toLocaleString()}</div>
              <div class="audit-list__ticket">{r.id}</div>
              <div class="audit-list__detail"><code style={{ fontSize: 'var(--text-xs)' }}>{r.body ? JSON.stringify(r.body).slice(0, 120) : r.path}</code></div>
              <div>
                <Button onClick={async () => { await deleteRule(r.id); reload(); }}>Cancel</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
