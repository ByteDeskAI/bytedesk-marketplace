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

  const count = rules?.length ?? 0;

  return (
    <AppShell activeView="chains" topBarTitle="Pending rules">
      <header class="page-header">
        <h2 class="page-header__title">Pending rules</h2>
        <span class={`tape ${count === 0 ? '' : 'tape--warn'}`}>
          {rules == null ? 'LOAD' : count === 0 ? 'CLEAR' : 'PENDING'}
        </span>
        <span class="page-header__sub">{count} queued</span>
        <span class="page-header__spacer" />
        <span class="page-header__sub">poll · 5s</span>
      </header>

      {err ? (
        <div class="empty-state" style={{ color: 'var(--color-state-error)', marginBottom: 'var(--space-3)' }}>
          <span class="empty-state__icon" aria-hidden>!</span>
          {err}
        </div>
      ) : null}

      <h3 class="section-heading">
        Rule queue
        <span class="section-heading__divider" />
        <span class="section-heading__count">{count}</span>
      </h3>

      {!rules ? (
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden>·</span>
          Loading…
        </div>
      ) : rules.length === 0 ? (
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden>∅</span>
          No pending rules.
          <div style={{ marginTop: 'var(--space-2)', textTransform: 'none', letterSpacing: 0 }}>
            Rules are created by <code>/fleet:wait</code>, <code>/fleet:cleanup</code>, and chain runs.
          </div>
        </div>
      ) : (
        <ul class="audit-list">
          {rules.map((r) => (
            <li key={r.id} class="audit-list__row" style={{ gridTemplateColumns: '180px 220px 1fr 110px 90px' }}>
              <div class="audit-list__time">{new Date(r.created).toLocaleString()}</div>
              <div class="audit-list__ticket">{r.id}</div>
              <div class="audit-list__detail">
                <code>{r.body ? JSON.stringify(r.body).slice(0, 160) : r.path}</code>
              </div>
              <div>
                <span class="tape tape--warn">PENDING</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Button onClick={async () => { await deleteRule(r.id); reload(); }}>Cancel</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
