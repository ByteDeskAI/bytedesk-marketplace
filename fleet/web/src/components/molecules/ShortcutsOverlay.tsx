// ShortcutsOverlay — Phase 7 (BDM-22, C3). Press `?` from anywhere to
// open. List is curated; expanded as additional pages add bindings.

import { useEffect } from 'preact/hooks';

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: '?',     desc: 'Toggle this overlay' },
  { keys: '/',     desc: 'Focus search' },
  { keys: 'g o',   desc: 'Go to overview' },
  { keys: 'd',     desc: 'Toggle density (compact ↔ comfortable)' },
  { keys: 'n',     desc: 'New session (open spawn modal)' },
  { keys: 'b',     desc: 'Broadcast input to all running sessions' },
  { keys: 'Esc',   desc: 'Close modals / clear selection' },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <header class="modal__header">Keyboard shortcuts</header>
        <div class="modal__body">
          <table class="kbd-table">
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.keys}>
                  <td>
                    {s.keys.split(' ').map((k, i) => (
                      <span key={i}>
                        <kbd class="kbd">{k}</kbd>{i < s.keys.split(' ').length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </td>
                  <td>{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
