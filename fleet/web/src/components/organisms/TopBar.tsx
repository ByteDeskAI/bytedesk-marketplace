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
      <div class="topbar__title">{title}</div>
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
        <Icon name="plus" size={14} />
        Spawn
      </Button>
    </div>
  );
}
