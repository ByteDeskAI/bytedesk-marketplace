// NodePalette — Phase 12.4 (BDM-28). Vertical list of node types.
// Drag a row onto the ChainCanvas to create a new node at the drop
// point, or click for a centered drop. Vanilla HTML5 drag-and-drop —
// no third-party graph libs.

import type { ChainNodeType } from '../../api';

export interface NodePaletteItem {
  type: ChainNodeType;
  label: string;
  hint: string;
  icon: string; // single-char glyph (we don't ship a real icon set)
}

export const PALETTE_ITEMS: NodePaletteItem[] = [
  { type: 'spawn',     label: 'Spawn',     hint: 'Run spawn-claude-feature',     icon: '⚙' },
  { type: 'wait',      label: 'Wait',      hint: 'Block until session state',    icon: '⏱' },
  { type: 'judge',     label: 'Judge',     hint: 'Haiku verdict (stub)',         icon: '⚖' },
  { type: 'condition', label: 'Condition', hint: 'Branch on expr',               icon: '◇' },
  { type: 'notify',    label: 'Notify',    hint: 'Send a message',               icon: '✉' },
  { type: 'script',    label: 'Script',    hint: 'Run bash (trusted only)',      icon: '$' },
];

export interface NodePaletteProps {
  onAdd?: (type: ChainNodeType) => void;
}

export function NodePalette({ onAdd }: NodePaletteProps) {
  return (
    <div class="chain-palette" aria-label="Node palette">
      <div class="chain-palette__heading">&gt; NODES · DRAG OR CLICK</div>
      <ul class="chain-palette__list">
        {PALETTE_ITEMS.map((item) => (
          <li
            key={item.type}
            class="chain-palette__item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer?.setData('application/x-fleet-node-type', item.type);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAdd?.(item.type)}
            title={item.hint}
          >
            <span class="chain-palette__icon" aria-hidden="true">{item.icon}</span>
            <div class="chain-palette__label-wrap">
              <div class="chain-palette__label">{item.label}</div>
              <div class="chain-palette__hint">{item.hint}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
