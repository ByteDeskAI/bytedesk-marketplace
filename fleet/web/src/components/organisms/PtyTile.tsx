// PtyTile — one tile in the grid. Body branches on the global view
// mode (terminal | chat). When the session has discovered sub-agents,
// terminal mode adds a tab strip — Parent + one tab per @agent — so
// the user can inspect what a sub-agent is doing even though it shares
// the parent's tmux pane (the sub-agent tabs are jsonl-derived log
// views, not real PTYs).

import { useState } from 'preact/hooks';
import { Badge } from '../atoms/Badge';
import { InteractiveTerminal } from './InteractiveTerminal';
import { ChatTile } from './ChatTile';
import { SubAgentThread } from './SubAgentThread';
import { useSessionStats } from '../../hooks/useSessionStats';
import { useViewMode } from '../../contexts/ViewModeContext';
import type { SessionRow } from '../../api';

export interface PtyTileProps {
  row: SessionRow;
}

function topTools(tools: Record<string, number> | undefined, n = 3): { name: string; count: number }[] {
  if (!tools) return [];
  return Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function fmtCost(usd: number): string {
  if (!usd || usd < 0.001) return '$0';
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function trimPrompt(s: string, n = 80): string {
  if (!s) return '';
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length > n ? cleaned.slice(0, n - 1) + '…' : cleaned;
}

export function PtyTile({ row }: PtyTileProps) {
  const { stats } = useSessionStats(row.ticket);
  const { mode } = useViewMode();
  const title = stats?.ai_title || row.slug || row.ticket;
  const tools = topTools(stats?.tools);
  const cost = stats?.cost_usd ?? 0;
  const prompt = stats?.last_prompt ? trimPrompt(stats.last_prompt) : '';
  const subAgents = stats?.sub_agents ?? [];

  // Terminal-mode tabs. Parent is always tab 0; sub-agents follow.
  // Pinned by agent_id so a re-render doesn't snap the user back.
  const [activeTab, setActiveTab] = useState<string>('');
  const showTabs = mode === 'terminal' && subAgents.length > 0;

  return (
    <div class="pty-tile">
      <div class="pty-tile__header">
        <code class="pty-tile__ticket">{row.ticket}</code>
        <strong class="pty-tile__title" title={stats?.ai_title || ''}>{title}</strong>
        <Badge state={row.state} />
        {tools.length > 0 && (
          <span class="pty-tile__tools">
            {tools.map((t) => (
              <span key={t.name} class="pty-tile__tool" title={`${t.count}× ${t.name}`}>
                {t.name}·{t.count}
              </span>
            ))}
          </span>
        )}
        {(stats?.compactions ?? 0) > 0 && (
          <span class="pty-tile__compact" title={`${stats?.compactions} compactions`}>↺</span>
        )}
        {(stats?.api_errors ?? 0) > 0 && (
          <span class="pty-tile__apierr" title={`${stats?.api_errors} API errors`}>⚠</span>
        )}
        <span class="pty-tile__spacer" />
        {cost > 0 && <span class="pty-tile__cost" title="cost so far">{fmtCost(cost)}</span>}
      </div>
      {prompt && (
        <div class="pty-tile__subhead" title={stats?.last_prompt}>
          <span class="pty-tile__subhead-prefix">›</span> {prompt}
        </div>
      )}
      {showTabs && (
        <div class="pty-tile__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ''}
            class={`pty-tile__tab${activeTab === '' ? ' pty-tile__tab--active' : ''}`}
            onClick={() => setActiveTab('')}
          >
            Parent
          </button>
          {subAgents.map((sa) => (
            <button
              key={sa.agent_id}
              type="button"
              role="tab"
              aria-selected={activeTab === sa.agent_id}
              class={`pty-tile__tab${activeTab === sa.agent_id ? ' pty-tile__tab--active' : ''} pty-tile__tab--${sa.status}`}
              onClick={() => setActiveTab(sa.agent_id)}
              title={`${sa.tool_total} tools · ${sa.status}`}
            >
              @{sa.agent_name || sa.agent_id}
            </button>
          ))}
        </div>
      )}
      <div class="pty-tile__body">
        {mode === 'chat' ? (
          <ChatTile row={row} />
        ) : activeTab === '' ? (
          <InteractiveTerminal ticket={row.ticket} />
        ) : (
          <SubAgentThread ticket={row.ticket} agentID={activeTab} />
        )}
      </div>
    </div>
  );
}
