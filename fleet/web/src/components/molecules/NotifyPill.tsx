// NotifyPill — Phase 12.3 (BDM-28, A12). Polls /api/notify-state and
// renders a tiny status pill: green (alive), amber (standby), grey (no
// daemon).

import { useEffect, useState } from 'preact/hooks';
import { fetchNotifyState, type NotifyState } from '../../api';

export function NotifyPill() {
  const [state, setState] = useState<NotifyState | null>(null);

  useEffect(() => {
    const load = () => fetchNotifyState().then(setState).catch(() => { /* ignore */ });
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, []);

  if (!state) return null;
  const tone =
    state.alive ? 'var(--color-state-done)' :
    state.holder_pid > 0 ? 'var(--color-state-needs-input)' :
    'var(--color-text-tertiary)';
  const label =
    state.alive ? 'notify · live' :
    state.holder_pid > 0 ? 'notify · stale lock' :
    'notify · off';
  return (
    <span
      title={`Holder PID: ${state.holder_pid || '—'} · alive: ${state.alive} · ${state.notify_dir}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 'var(--text-xs)', color: tone,
      }}
    >
      ● {label}
    </span>
  );
}
