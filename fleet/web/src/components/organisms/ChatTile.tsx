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

const INITIAL_FIRST_INDEX = 1_000_000;

export function ChatTile({ row }: ChatTileProps) {
  const { messages, sendMessage, sendKeys, isLoading, error, loadMore, hasMore, loadingMore, connection } =
    useFleetChat(row.ticket);
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

  // Items + firstItemIndex are stored together so a prepend (older
  // history loaded) updates BOTH in a single render — Virtuoso
  // requires that to anchor scroll correctly, and to re-arm
  // `startReached` for the new top (BDM-37 follow-up). Tracking
  // them as separate state values produced a one-render lag where
  // Virtuoso saw `data` grow but `firstItemIndex` unchanged, which
  // it interpreted as an APPEND — locking the user out of further
  // scroll-ups.
  const [view, setView] = useState<{ items: RenderItem[]; firstItemIndex: number }>({
    items: [],
    firstItemIndex: INITIAL_FIRST_INDEX,
  });
  const { items, firstItemIndex } = view;

  // Bottom-tracking + unread badge (BDM-36).
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const prevLastKeyRef = useRef<string>('');

  // Recompute items from messages, atomically updating firstItemIndex
  // when growth is detected at the start of the array.
  useEffect(() => {
    const next = groupMessages(messages);
    setView((prev) => {
      // Initial seed or no growth → just swap items, keep firstItemIndex.
      if (prev.items.length === 0 || next.length <= prev.items.length) {
        return { items: next, firstItemIndex: prev.firstItemIndex };
      }
      // Detect prepend by finding the previous first item's key in the
      // new array.
      const prevFirstKey = prev.items[0].key;
      const newIdxOfPrevFirst = next.findIndex((it) => it.key === prevFirstKey);
      if (newIdxOfPrevFirst > 0) {
        return {
          items: next,
          firstItemIndex: Math.max(0, prev.firstItemIndex - newIdxOfPrevFirst),
        };
      }
      // Append (or unchanged top) — no firstItemIndex shift.
      return { items: next, firstItemIndex: prev.firstItemIndex };
    });
  }, [messages]);

  // Track new messages at the bottom; bump unread when the user is
  // scrolled up. We key off the LAST item id so prepends don't count.
  useEffect(() => {
    if (items.length === 0) { prevLastKeyRef.current = ''; return; }
    const lastKey = items[items.length - 1].key;
    if (prevLastKeyRef.current && prevLastKeyRef.current !== lastKey && !atBottom) {
      setUnread((u) => u + 1);
    }
    prevLastKeyRef.current = lastKey;
  }, [items, atBottom]);

  useEffect(() => {
    if (atBottom) setUnread(0);
  }, [atBottom]);

  const onStartReached = () => {
    if (loadingMore || !hasMore) return;
    // Don't auto-fetch when the chat fits in the viewport (start ===
    // bottom). Otherwise sending a message bumps items.length, fires
    // startReached as a side-effect of the scroll-to-bottom, and we
    // bounce the user to the (now-prepended) top. Only fetch when
    // the user has actually scrolled away from the bottom (BDM-41).
    if (atBottom) return;
    void loadMore();
  };

  const scrollToBottom = () => {
    vRef.current?.scrollToIndex({ index: firstItemIndex + items.length - 1, behavior: 'smooth' });
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
            firstItemIndex={firstItemIndex}
            followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
            atBottomStateChange={setAtBottom}
            atBottomThreshold={48}
            initialTopMostItemIndex={firstItemIndex + items.length - 1}
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
                return <ToolGroupCard messages={item.messages} showRole={item.showRole} />;
              }
              return (
                <MessageBubble
                  msg={item.msg}
                  showRole={item.showRole}
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
        {connection !== 'live' && messages.length > 0 && (
          <div class={`chat-tile__conn chat-tile__conn--${connection}`} title="SSE connection state">
            {connection === 'reconnecting' ? '◐ reconnecting…' : '○ disconnected'}
          </div>
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
