/**
 * Commands the ⌘K palette offers. The shell contributes routes and entities; a screen
 * contributes its own actions while it is mounted (the board: "move TM-014 to done").
 */
import { useEffect, useSyncExternalStore } from "react";

export interface Command {
  id?: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

const sources = new Map<symbol, () => Command[]>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((fn) => fn());
};

/** Register a command source for the lifetime of the component. */
export function usePaletteCommands(source: () => Command[], deps: unknown[]) {
  useEffect(() => {
    const key = Symbol();
    sources.set(key, source);
    bump();
    return () => {
      sources.delete(key);
      bump();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function usePaletteVersion() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
}

export const allCommands = (): Command[] => [...sources.values()].flatMap((s) => s());
