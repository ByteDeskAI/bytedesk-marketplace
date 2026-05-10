// ChatTile — UI-mode body for one tile. Renders the session's
// projected UIMessages via react-virtuoso for sticky-bottom autoscroll
// and lazy DOM construction (jsonl can hit 30MB and 1000s of turns).
//
// Composer (textarea + send) is the shared ChatComposer molecule. It
// POSTs to /api/sessions/<T>/send (existing tmux send-keys wrapper)
// so users can reply / interject without leaving chat mode.

import { useEffect, useMemo, useRef } from 'preact/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useFleetChat } from '../../hooks/useFleetChat';
import { useSessionStats } from '../../hooks/useSessionStats';
import { MessageBubble } from './MessageBubble';
import { SubAgentThread } from './SubAgentThread';
import { ToolGroupCard } from '../molecules/ToolGroupCard';
import { ChatComposer } from '../molecules/ChatComposer';
import { groupMessages, type RenderItem } from '../../lib/groupMessages';
import type { SessionRow } from '../../api';

export interface ChatTileProps {
  row: SessionRow;
}

export function ChatTile({ row }: ChatTileProps) {
  const { messages, sendMessage, sendKeys, isLoading, error } = useFleetChat(row.ticket);
  const { stats } = useSessionStats(row.ticket);
  const vRef = useRef<VirtuosoHandle | null>(null);

  // Sub-agent index — Task tool_use_id → agent_id, so the renderer
  // can look up which nested SubAgentThread to render under each
  // tool-call.
  const subAgentIDs = useMemo(() => {
    const set = new Set<string>();
    for (const sa of stats?.sub_agents ?? []) set.add(sa.agent_id);
    return set;
  }, [stats?.sub_agents]);

  // Collapse runs of consecutive tool-only assistant messages into a
  // single ToolGroup card (BDM-33).
  const items = useMemo<RenderItem[]>(() => groupMessages(messages), [messages]);

  useEffect(() => {
    if (!vRef.current) return;
    if (items.length === 0) return;
    vRef.current.scrollToIndex({ index: items.length - 1, behavior: 'smooth' });
  }, [items.length]);

  return (
    <div class="chat-tile">
      <div class="chat-tile__list">
        {error ? (
          <div class="chat-tile__error">failed to load: {error}</div>
        ) : isLoading && messages.length === 0 ? (
          <div class="chat-tile__loading">loading…</div>
        ) : messages.length === 0 ? (
          <div class="chat-tile__empty">no messages yet — send one below.</div>
        ) : (
          <Virtuoso
            ref={vRef}
            data={items}
            followOutput="smooth"
            initialTopMostItemIndex={Math.max(0, items.length - 1)}
            computeItemKey={(_, it) => (it as RenderItem).key}
            itemContent={(_, it) => {
              const item = it as RenderItem;
              if (item.kind === 'toolGroup') {
                return <ToolGroupCard messages={item.messages} />;
              }
              return (
                <MessageBubble
                  msg={item.msg}
                  onAnswerKeys={sendKeys}
                  renderSubAgent={(subID) =>
                    subAgentIDs.has(subID) ? (
                      <SubAgentThread ticket={row.ticket} agentID={subID} />
                    ) : null
                  }
                />
              );
            }}
            increaseViewportBy={{ top: 200, bottom: 800 }}
          />
        )}
      </div>
      <ChatComposer
        onSend={sendMessage}
        disabled={row.state === 'starting'}
        placeholder={
          row.state === 'starting'
            ? 'session starting…'
            : `reply to ${row.ticket} (Enter sends, Shift+Enter newline)`
        }
      />
    </div>
  );
}
