// SubAgentTree — renders the sub-agent transcripts discovered for a
// session. Each row shows agent id/name, status, token usage, and
// tool tally. Now backed by real data from TicketStats.sub_agents
// (BDM-32: server tails `subagents/agent-<id>.jsonl` per session).

import type { SubAgentInfo } from '../../api';

export interface SubAgentTreeProps {
  agents?: SubAgentInfo[];
  onSelect?: (agentID: string) => void;
}

function tokenSummary(a: SubAgentInfo): string {
  const total = (a.tokens_in ?? 0) + (a.tokens_out ?? 0);
  if (!total) return '';
  return `${a.tokens_in.toLocaleString()}↓ ${a.tokens_out.toLocaleString()}↑`;
}

function topTools(a: SubAgentInfo, n = 3): string[] {
  if (!a.tools) return [];
  return Object.entries(a.tools)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([name, count]) => `${name}·${count}`);
}

export function SubAgentTree({ agents, onSelect }: SubAgentTreeProps) {
  const list = agents ?? [];

  return (
    <section class="sub-agent-tree">
      <h4 class="sub-agent-tree__title">Sub-agents</h4>
      {list.length === 0 ? (
        <div class="sub-agent-tree__empty">No sub-agents spawned</div>
      ) : (
        <ul class="sub-agent-tree__list">
          {list.map((a) => {
            const tokens = tokenSummary(a);
            const tools = topTools(a);
            return (
              <li
                key={a.agent_id}
                class={`sub-agent-tree__row sub-agent-tree__row--${a.status}`}
                onClick={() => onSelect?.(a.agent_id)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                <span class="sub-agent-tree__bullet" aria-hidden="true">└─</span>
                <span class="sub-agent-tree__name">{a.agent_name || a.agent_id}</span>
                <span class={`sub-agent-tree__status sub-agent-tree__status--${a.status}`}>{a.status}</span>
                {tokens && <span class="sub-agent-tree__tokens">{tokens}</span>}
                {tools.map((t) => (
                  <span key={t} class="sub-agent-tree__tool">{t}</span>
                ))}
                {a.errors > 0 && <span class="sub-agent-tree__err">⚠ {a.errors}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
