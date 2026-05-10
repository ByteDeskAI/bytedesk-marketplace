// GridLayout — Phase 12.1 (BDM-28, B3 multi-PTY grid).
//
// The grid always fills its container. Tile dimensions are computed
// from the actual count: 1 tile = 1×1 (full), 2 = 1×2, 3-4 = 2×2, etc.
// The named "strategy" caps the max count so the user can keep extra
// fleet sessions out of the visible area while still letting the
// rendered tiles claim every pixel.

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
  count: number;
  children: ComponentChildren;
}

/** Compute (cols, rows) so the grid fills the container with `count`
 *  tiles of approximately equal size. Roughly square. */
function dims(count: number, strategy: GridStrategy): { cols: number; rows: number; firstSpan?: { col: number; row: number } } {
  if (count <= 1) return { cols: 1, rows: 1 };

  // Spotlight: one big tile + thumbnails. Layout = 1 wide row split:
  // [big] [thumb,thumb,...]. Implemented via a 2-col grid where the
  // first cell spans both rows when there are 2..N tiles.
  if (strategy === 'spotlight' && count >= 2) {
    const rest = count - 1;
    return { cols: 2, rows: rest, firstSpan: { col: 1, row: rest } };
  }

  // 1+N: one big tile on the left + N stacked on the right (max 4).
  if (strategy === '1plusN' && count >= 2) {
    const rest = count - 1;
    return { cols: 2, rows: rest, firstSpan: { col: 1, row: rest } };
  }

  // Default: square-ish auto-pack.
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

export function GridLayout({ strategy, count, children }: GridLayoutProps) {
  const d = dims(count, strategy);
  const style: Record<string, string> = {
    gridTemplateColumns: `repeat(${d.cols}, 1fr)`,
    gridTemplateRows: `repeat(${d.rows}, 1fr)`,
  };
  return (
    <div
      class={`grid-layout${d.firstSpan ? ' grid-layout--has-span' : ''}`}
      style={style}
    >
      {children}
    </div>
  );
}
