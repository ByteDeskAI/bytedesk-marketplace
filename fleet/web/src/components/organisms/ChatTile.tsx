// ChatTile — UI-mode body for one tile. Renders the session's
// projected UIMessages via react-virtuoso for sticky-bottom autoscroll
// and lazy DOM construction (jsonl can hit 30MB and 1000s of turns).
//
// Composer (textarea + send) is the shared ChatComposer molecule. It
// POSTs to /api/sessions/<T>/send (existing tmux send-keys wrapper)
// so users can reply / interject without leaving chat mode.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  const { messages, sendMessage, sendKeys, isLoading, error, loadMore, hasMore, loadingMore } =
    useFleetChat(row.ticket);
  const { stats } = useSessionStats(row.ticket);
  const vRef = useRef<VirtuosoHandle | null>(null);
  // Post-load scroll restore: when older messages prepend, the items
  // array length jumps. We capture the pre-load length and, after
  // render, scroll to the index that USED TO BE the topmost so the
  // user keeps reading where they were instead of getting bounced to
  // the new (older) top.
  const [pendingRestore, setPendingRestore] = useState<number | null>(null);

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

  // Bottom-tracking + unread badge (BDM-36). Virtuoso's followOutput
  // already autoscrolls only when the user is at the bottom; we keep
  // that as the autoscroll signal and surface a clickable "↓ N new"
  // banner whenever new items land while the user is scrolled up.
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const prevLastKeyRef = useRef<string>('');

  // Post-load scroll restore — older messages just prepended. Jump
  // to the item that was index 0 before so the user stays anchored
  // on the message they were reading.
  useEffect(() => {
    if (!vRef.current || items.length === 0 || pendingRestore === null) return;
    const newIdx = items.length - pendingRestore;
    if (newIdx > 0) {
      vRef.current.scrollToIndex({ index: newIdx, align: 'start', behavior: 'auto' });
    }
    setPendingRestore(null);
  }, [items.length, pendingRestore]);

  // Track new messages at the bottom; bump unread when the user is
  // scrolled up. We key off the LAST item id so prepends don't count.
  useEffect(() => {
    if (items.length === 0) { prevLastKeyRef.current = ''; return; }
    const lastKey = items[items.length - 1].key;
    if (prevLastKeyRef.current && prevLastKeyRef.current !== lastKey && pendingRestore === null && !atBottom) {
      setUnread((u) => u + 1);
    }
    prevLastKeyRef.current = lastKey;
  }, [items, atBottom, pendingRestore]);

  // Returning to the bottom clears the unread counter.
  useEffect(() => {
    if (atBottom) setUnread(0);
  }, [atBottom]);

  const onStartReached = () => {
    if (loadingMore || !hasMore) return;
    setPendingRestore(items.length);
    void loadMore();
  };

  const scrollToBottom = () => {
    vRef.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth' });
    setUnread(0);
  };

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
            followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
            atBottomStateChange={setAtBottom}
            atBottomThreshold={48}
            initialTopMostItemIndex={Math.max(0, items.length - 1)}
            startReached={onStartReached}
            components={{
              Header: () =>
                loadingMore ? (
                  <div class="chat-tile__more">loading older…</div>
                ) : !hasMore && items.length > 0 ? (
                  <div class="chat-tile__more chat-tile__more--end">— start of conversation —</div>
                ) : null,
            }}
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
        {unread > 0 && !atBottom && (
          <button
            type="button"
            class="chat-tile__unread"
            onClick={scrollToBottom}
            title="Scroll to latest"
          >
            ↓ {unread} new {unread === 1 ? 'message' : 'messages'}
          </button>
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
