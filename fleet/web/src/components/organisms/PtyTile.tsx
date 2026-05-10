// PtyTile — Phase 12.1 (BDM-28, B3). One xterm.js terminal in the grid.

import { Badge } from '../atoms/Badge';
import { InteractiveTerminal } from './InteractiveTerminal';
import type { SessionRow } from '../../api';

export interface PtyTileProps {
  row: SessionRow;
}

export function PtyTile({ row }: PtyTileProps) {
  return (
    <div class="pty-tile">
      <div class="pty-tile__header">
        <strong>{row.ticket}</strong>
        <span style={{ color: 'var(--color-text-tertiary)' }}>{row.slug || '—'}</span>
        <Badge state={row.state} />
      </div>
      <div class="pty-tile__body">
        <InteractiveTerminal ticket={row.ticket} />
      </div>
    </div>
  );
}
