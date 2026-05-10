// useShortcuts — Phase 7 (BDM-22 / C3). Global key bindings.
// Honors text-input focus (does not fire while user is typing).
//
// Chord nav (BDM-40): pressing `g` then a destination letter navigates
// the SPA hash router. Sidebar advertises the chords (gO, gG, gT, gC,
// gN, gA, gR, g,) — this hook makes them work. Chord state self-clears
// after 1 s if no second key arrives.

import { useEffect } from 'preact/hooks';

export interface ShortcutBindings {
  onHelp?: () => void;
  onFocusSearch?: () => void;
  onToggleDensity?: () => void;
  onSpawn?: () => void;
  onBroadcast?: () => void;
  onEscape?: () => void;
  /** Chord nav target (called with hash path like "/grid"). Wire to useRoute's navigate. */
  onNavigate?: (path: string) => void;
}

const TYPING = /^(input|textarea|select)$/i;

// Maps the second key of a `g`-prefixed chord to a hash route. The
// lookup is case-insensitive (`g` then `G` and `g` then `g` both fire).
const CHORD_NAV: Record<string, string> = {
  O: '/',
  G: '/grid',
  T: '/timeline',
  C: '/chains',
  N: '/tournaments',
  A: '/audit',
  R: '/rules',
  ',': '/settings',
};

const CHORD_TIMEOUT_MS = 1000;

export function useShortcuts(b: ShortcutBindings) {
  useEffect(() => {
    let pendingChord: 'g' | null = null;
    let chordTimer: number | null = null;

    const clearChord = () => {
      pendingChord = null;
      if (chordTimer != null) { window.clearTimeout(chordTimer); chordTimer = null; }
    };

    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const isTyping = !!t && (TYPING.test(t.tagName) || (t as HTMLElement).isContentEditable);

      if (e.key === 'Escape') { b.onEscape?.(); clearChord(); return; }
      if (isTyping) return;

      // Resolve a pending `g`-chord if one is open.
      if (pendingChord === 'g') {
        const lookupKey = e.key === ',' ? ',' : e.key.toUpperCase();
        const target = CHORD_NAV[lookupKey];
        clearChord();
        if (target && b.onNavigate) {
          e.preventDefault();
          b.onNavigate(target);
          return;
        }
        // Second key wasn't a known chord destination; fall through so
        // single-key shortcuts still get a chance to run on it.
      }

      // Begin a `g`-prefixed chord.
      if (e.key === 'g' || e.key === 'G') {
        pendingChord = 'g';
        chordTimer = window.setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }

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
    return () => {
      window.removeEventListener('keydown', handler);
      clearChord();
    };
  }, [b]);
}
