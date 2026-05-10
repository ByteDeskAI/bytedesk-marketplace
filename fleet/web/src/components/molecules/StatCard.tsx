import { Sparkline } from '../atoms/Sparkline';

export interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { value: string; direction?: 'up' | 'down' | 'flat' };
  caption?: string;
  series?: number[];
  accent?: string;
}

export function StatCard({ label, value, delta, caption, series, accent }: StatCardProps) {
  return (
    <div class="stat-card">
      <div class="stat-card__label">{label}</div>
      <div class="stat-card__value">{value}</div>
      {delta ? (
        <div class={`stat-card__delta stat-card__delta--${delta.direction ?? 'flat'}`}>
          {delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : ''} {delta.value}
        </div>
      ) : null}
      {caption ? <div class="stat-card__delta">{caption}</div> : null}
      {series ? (
        <div class="stat-card__sparkline" style={{ color: accent ?? 'var(--color-accent)' }}>
          <Sparkline data={series} />
        </div>
      ) : null}
    </div>
  );
}
