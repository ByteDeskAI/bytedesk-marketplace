import { StatCard } from '../molecules/StatCard';
import type { FleetStats } from '../../api';

export interface StatRibbonProps {
  stats: FleetStats;
}

export function StatRibbon({ stats }: StatRibbonProps) {
  return (
    <section class="stat-ribbon" aria-label="Fleet statistics">
      <StatCard
        label="Active Sessions"
        value={stats.active_sessions.value}
        caption={`/${stats.active_sessions.total} running`}
      />
      <StatCard
        label="Needs Input"
        value={stats.needs_input.value}
        delta={{ value: String(stats.needs_input.delta), direction: stats.needs_input.delta > 0 ? 'up' : 'flat' }}
      />
      <StatCard
        label="Completed"
        value={stats.completed.value}
        caption={stats.completed.window}
      />
      <StatCard
        label="Est. Cost (24h)"
        value={stats.est_cost_24h.value}
        delta={{ value: `${stats.est_cost_24h.delta_pct}%`, direction: 'up' }}
        series={stats.est_cost_24h.series}
      />
      <StatCard
        label="Runtime (24h)"
        value={stats.runtime_24h.value}
        caption="Total"
        series={stats.runtime_24h.series}
        accent="var(--color-state-working)"
      />
      <StatCard
        label="Events (24h)"
        value={stats.events_24h.value.toLocaleString()}
        delta={{ value: `${stats.events_24h.delta_pct}%`, direction: 'up' }}
        series={stats.events_24h.series}
        accent="var(--color-state-reviewing)"
      />
    </section>
  );
}
