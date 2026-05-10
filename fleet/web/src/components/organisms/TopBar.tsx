// TopBar — section breadcrumb, live indicator, time-range filter, spawn
// CTA. Title is rendered as a mono breadcrumb (FLEET / <SECTION>) to
// match the mission-control aesthetic.

import { useState } from 'preact/hooks';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';

const RANGES = ['Live', '5m', '15m', '1h', '6h', '24h'];

export interface TopBarProps {
  title: string;
  onSpawnClick?: () => void;
}

export function TopBar({ title, onSpawnClick }: TopBarProps) {
  const [range, setRange] = useState('Live');
  return (
    <div class="app-shell__topbar">
      <span class="topbar__crumb">FLEET</span>
      <span class="topbar__crumb-sep">/</span>
      <span class="topbar__title">{title}</span>
      <span class="topbar__live" title="Server-Sent Events stream">
        <span class="topbar__live-dot" />
        live
      </span>
      <div class="topbar__spacer" />
      <div class="topbar__time-range" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <Button variant="primary" onClick={onSpawnClick}>
        <Icon name="plus" size={12} />
        Spawn
      </Button>
    </div>
  );
}
