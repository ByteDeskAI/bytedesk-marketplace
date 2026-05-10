// useShortcuts — Phase 7 (BDM-22 / C3). Global key bindings.
// Honors text-input focus (does not fire while user is typing).

import { useEffect } from 'preact/hooks';

export interface ShortcutBindings {
  onHelp?: () => void;
  onFocusSearch?: () => void;
  onToggleDensity?: () => void;
  onSpawn?: () => void;
  onBroadcast?: () => void;
  onEscape?: () => void;
}

const TYPING = /^(input|textarea|select)$/i;

export function useShortcuts(b: ShortcutBindings) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const isTyping = !!t && (TYPING.test(t.tagName) || (t as HTMLElement).isContentEditable);

      if (e.key === 'Escape') { b.onEscape?.(); return; }
      if (isTyping) return;

      switch (e.key) {
        case '?':
          e.preventDefault();
          b.onHelp?.();
          break;
        case '/':
          e.preventDefault();
          b.onFocusSearch?.();
          break;
        case 'd':
          b.onToggleDensity?.();
          break;
        case 'n':
          b.onSpawn?.();
          break;
        case 'b':
          b.onBroadcast?.();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [b]);
}
