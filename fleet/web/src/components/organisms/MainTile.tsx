// MainTile — always-present terminal in the multi-agent grid.
// Connects to the dashboard's persistent `fleet-main-<KEY>` tmux
// session via /api/main/pty. The main session survives dashboard
// restarts (tmux owns it) and gives the user a working shell rooted
// in the project worktree, regardless of how many fleet child
// sessions are running.
//
// Honors the global Terminal/Chat view mode (BDM-32). In chat mode,
// renders a structured-message view sourced from /api/main/messages
// + /api/main/transcript SSE, with a working composer wired to
// /api/main/send (BDM-33) so users can drive the persistent shell
// from chat mode.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { InteractiveTerminal } from './InteractiveTerminal';
import { MessageBubble } from './MessageBubble';
import { ToolGroupCard } from '../molecules/ToolGroupCard';
import { ChatComposer } from '../molecules/ChatComposer';
import { useFleetChat } from '../../hooks/useFleetChat';
import { useViewMode } from '../../contexts/ViewModeContext';
import { groupMessages, type RenderItem } from '../../lib/groupMessages';

export function MainTile() {
  const { mode } = useViewMode();
  return (
    <div class="pty-tile pty-tile--main">
      <div class="pty-tile__header">
        <span class="tape tape--accent">MAIN</span>
        <strong class="pty-tile__title">persistent shell</strong>
        <span class="pty-tile__spacer" />
        <span class="tape tape--ok">ALWAYS-ON</span>
        <code class="pty-tile__ticket">fleet-main</code>
      </div>
      <div class="pty-tile__body">
        {mode === 'chat' ? <MainChatBody /> : <InteractiveTerminal ticket="_main" wsPath="/api/main/pty" />}
      </div>
    </div>
  );
}

function MainChatBody() {
  const { messages, sendMessage, sendKeys, isLoading, error, loadMore, hasMore, loadingMore } =
    useFleetChat('__main__', {
      messagesURL: '/api/main/messages',
      transcriptURL: '/api/main/transcript',
      sendURL: '/api/main/send',
      keysURL: '/api/main/keys',
    });
  const vRef = useRef<VirtuosoHandle | null>(null);
  // Bundle items + firstItemIndex so a prepend updates both atomically
  // — Virtuoso requires that to preserve scroll + re-arm startReached
  // (see ChatTile.tsx for the full reasoning).
  const [view, setView] = useState<{ items: RenderItem[]; firstItemIndex: number }>({
    items: [],
    firstItemIndex: 1_000_000,
  });
  const { items, firstItemIndex } = view;
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const prevLastKeyRef = useRef<string>('');

  useEffect(() => {
    const next = groupMessages(messages);
    setView((prev) => {
      if (prev.items.length === 0 || next.length <= prev.items.length) {
        return { items: next, firstItemIndex: prev.firstItemIndex };
      }
      const prevFirstKey = prev.items[0].key;
      const newIdxOfPrevFirst = next.findIndex((it) => it.key === prevFirstKey);
      if (newIdxOfPrevFirst > 0) {
        return { items: next, firstItemIndex: Math.max(0, prev.firstItemIndex - newIdxOfPrevFirst) };
      }
      return { items: next, firstItemIndex: prev.firstItemIndex };
    });
  }, [messages]);

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
        ) : items.length === 0 ? (
          <div class="chat-tile__empty">no main-tile activity yet — type below to start.</div>
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
              if (item.kind === 'toolGroup') return <ToolGroupCard messages={item.messages} showRole={item.showRole} />;
              return <MessageBubble msg={item.msg} showRole={item.showRole} onAnswerKeys={sendKeys} />;
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
        placeholder="reply to main shell (Enter sends, Shift+Enter newline)"
      />
    </div>
  );
}
