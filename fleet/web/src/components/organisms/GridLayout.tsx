// GridLayout — Phase 12.1 (BDM-28, B3 multi-PTY grid).
//
// Strategy pattern: GridStrategy is a name string; the CSS grid does the
// actual layout work via class modifiers. The `tiles` array is just the
// list of session tickets to render; the strategy controls how many fit.

import type { ComponentChildren } from 'preact';

export type GridStrategy = '2x2' | '3x3' | '1plusN' | 'spotlight';

export const GRID_STRATEGIES: { id: GridStrategy; label: string; max: number }[] = [
  { id: '2x2',       label: 'Grid 2×2',   max: 4 },
  { id: '3x3',       label: 'Grid 3×3',   max: 9 },
  { id: '1plusN',    label: '1+N',        max: 4 },
  { id: 'spotlight', label: 'Spotlight',  max: 5 },
];

export interface GridLayoutProps {
  strategy: GridStrategy;
  children: ComponentChildren;
}

export function GridLayout({ strategy, children }: GridLayoutProps) {
  return <div class={`grid-layout grid-layout--${strategy}`}>{children}</div>;
}
