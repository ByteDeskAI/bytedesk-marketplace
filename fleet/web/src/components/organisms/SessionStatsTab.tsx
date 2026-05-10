// SessionStatsTab — Phase 12.x (features #1–#7, #10, #12, #15).
// Composite of the per-ticket transcript-derived stats. Single
// scrolling tab so the user can see headline / tokens / tools / latency
// / sub-agents at a glance.

import { useState } from 'preact/hooks';
import { useSessionStats } from '../../hooks/useSessionStats';
import { ToolLatencyHistogram } from '../molecules/ToolLatencyHistogram';
import { SubAgentTree } from '../molecules/SubAgentTree';
import type { TicketStats } from '../../api';

const PROMPT_LINE_CAP = 3;

function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function fmtRelative(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const delta = Date.now() - d.getTime();
  if (delta < 0) return d.toLocaleString();
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleString();
}

export interface SessionStatsTabProps {
  ticket: string;
}

export function SessionStatsTab({ ticket }: SessionStatsTabProps) {
  const { stats, error } = useSessionStats(ticket);
  const [expandPrompt, setExpandPrompt] = useState(false);

  if (error) {
    return <div style={{ color: 'var(--color-state-error)' }}>{error}</div>;
  }
  if (!stats) {
    return <div style={{ color: 'var(--color-text-tertiary)' }}>Loading stats…</div>;
  }

  return (
    <div class="session-stats">
      <StatsHeader stats={stats} />
      <PromptBlock stats={stats} expanded={expandPrompt} onToggle={() => setExpandPrompt(!expandPrompt)} />
      <TokenGrid stats={stats} />
      <ToolBars stats={stats} />
      <SubAgentTree agents={stats.sub_agents} />
      <MetaRow stats={stats} />
      <ToolLatencyHistogram data={stats.tool_latency_ms} />
    </div>
  );
}

function StatsHeader({ stats }: { stats: TicketStats }) {
  const title = stats.ai_title?.trim() || stats.ticket;
  return (
    <header class="session-stats__header">
      <div class="session-stats__title">{title}</div>
      <div class="session-stats__sub">
        {stats.agent_name ? <span>{stats.agent_name}</span> : null}
        {stats.permission_mode === 'plan' ? (
          <span class="session-stats__pill session-stats__pill--plan">📋 plan mode</span>
        ) : null}
        {stats.permission_mode === 'bypassPermissions' ? (
          <span class="session-stats__pill session-stats__pill--unsafe">⚠ bypassPermissions</span>
        ) : null}
      </div>
    </header>
  );
}

function PromptBlock({
  stats,
  expanded,
  onToggle,
}: {
  stats: TicketStats;
  expanded: boolean;
  onToggle: () => void;
}) {
  const text = (stats.last_prompt ?? '').trim();
  if (!text) {
    return (
      <div class="session-stats__prompt session-stats__prompt--empty">
        No user prompt captured yet.
      </div>
    );
  }
  return (
    <div
      class={`session-stats__prompt${expanded ? ' session-stats__prompt--expanded' : ''}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      title={expanded ? 'Collapse' : 'Expand'}
      style={{ WebkitLineClamp: expanded ? 'unset' : String(PROMPT_LINE_CAP) }}
    >
      <em>{text}</em>
    </div>
  );
}

function TokenGrid({ stats }: { stats: TicketStats }) {
  return (
    <div class="session-stats__tokens">
      <TokenCell label="Tokens in" value={fmtNumber(stats.tokens_in)} />
      <TokenCell label="Tokens out" value={fmtNumber(stats.tokens_out)} />
      <TokenCell label="Cache hit" value={fmtNumber(stats.tokens_cache_hit)} />
      <TokenCell label="Cost" value={fmtCost(stats.cost_usd)} />
    </div>
  );
}

function TokenCell({ label, value }: { label: string; value: string }) {
  return (
    <div class="session-stats__token-cell">
      <div class="session-stats__token-label">{label}</div>
      <div class="session-stats__token-value">{value}</div>
    </div>
  );
}

function ToolBars({ stats }: { stats: TicketStats }) {
  const tools = stats.tools ?? {};
  const sorted = Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (sorted.length === 0) {
    return (
      <section class="session-stats__tools">
        <h4 class="session-stats__section-title">Top tools</h4>
        <div class="session-stats__empty">No tool calls yet.</div>
      </section>
    );
  }
  const max = sorted.reduce((m, [, n]) => (n > m ? n : m), 1);
  return (
    <section class="session-stats__tools">
      <h4 class="session-stats__section-title">Top tools</h4>
      <ul class="session-stats__tool-list">
        {sorted.map(([name, count]) => {
          const pct = Math.max(2, (count / max) * 100);
          return (
            <li key={name} class="session-stats__tool-row">
              <span class="session-stats__tool-name" title={name}>{name}</span>
              <div class="session-stats__tool-bar-wrap">
                <div class="session-stats__tool-bar" style={{ width: `${pct}%` }} />
              </div>
              <span class="session-stats__tool-count">{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MetaRow({ stats }: { stats: TicketStats }) {
  const errColor = (n: number) => (n > 0 ? 'var(--color-state-error)' : 'inherit');
  const brewed =
    stats.last_turn_duration_ms != null
      ? `${(stats.last_turn_duration_ms / 1000).toFixed(1)}s`
      : '—';
  return (
    <dl class="session-stats__meta">
      <dt>Compactions</dt><dd>{stats.compactions}</dd>
      <dt>Queue depth</dt><dd>{stats.queue_depth}</dd>
      <dt>Errors</dt><dd><span style={{ color: errColor(stats.errors) }}>{stats.errors}</span></dd>
      <dt>API errors</dt><dd><span style={{ color: errColor(stats.api_errors) }}>{stats.api_errors}</span></dd>
      <dt>Brewed for</dt><dd>{brewed}</dd>
      <dt>Last turn</dt><dd>{fmtRelative(stats.last_turn_at)}</dd>
      <dt>Last stop reason</dt><dd>{stats.last_stop_reason || '—'}</dd>
    </dl>
  );
}
