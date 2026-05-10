// PtyTile — Phase 12.1 (BDM-28, B3). One xterm.js terminal in the grid.
// Header pulls live transcript-derived stats: AI-assigned title, last
// prompt preview, top tool calls, and running cost. The ticket key is
// kept as a small monospace handle on the right so users can still spot
// which session a tile belongs to.

import { Badge } from '../atoms/Badge';
import { InteractiveTerminal } from './InteractiveTerminal';
import { useSessionStats } from '../../hooks/useSessionStats';
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
  const title = stats?.ai_title || row.slug || row.ticket;
  const tools = topTools(stats?.tools);
  const cost = stats?.cost_usd ?? 0;
  const prompt = stats?.last_prompt ? trimPrompt(stats.last_prompt) : '';

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
      <div class="pty-tile__body">
        <InteractiveTerminal ticket={row.ticket} />
      </div>
    </div>
  );
}
