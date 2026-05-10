// ViewModeContext — global Terminal/Chat toggle for tiles. Persisted
// to localStorage so the user's choice survives reloads.
//
// The toggle lives in GridPage's header; tiles read the current mode
// via useViewMode() and render either InteractiveTerminal (terminal)
// or ChatTile (chat).

import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export type ViewMode = 'terminal' | 'chat';

const STORAGE_KEY = 'fleet:view-mode';

interface ViewModeContextValue {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}

const Ctx = createContext<ViewModeContextValue>({
  mode: 'terminal',
  setMode: () => {},
});

export function ViewModeProvider({ children }: { children: ComponentChildren }) {
  const [mode, setModeState] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'chat' || v === 'terminal') return v;
    } catch { /* ignore */ }
    return 'terminal';
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  return <Ctx.Provider value={{ mode, setMode: setModeState }}>{children}</Ctx.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  return useContext(Ctx);
}
