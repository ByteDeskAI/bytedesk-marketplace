// NotifyPill — Phase 12.3 (BDM-28, A12). Polls /api/notify-state and
// renders a small status pill in the sidebar footer. Visual treatment is
// the .notify-pill class in styles.css.

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
  const variant = state.alive ? 'active' : '';
  const label =
    state.alive ? 'notify' :
    state.holder_pid > 0 ? 'stale' :
    'off';
  return (
    <span
      class={`notify-pill${variant ? ` notify-pill--${variant}` : ''}`}
      title={`Holder PID: ${state.holder_pid || '—'} · alive: ${state.alive} · ${state.notify_dir}`}
    >
      <span class="notify-pill__dot" />
      {label}
    </span>
  );
}
