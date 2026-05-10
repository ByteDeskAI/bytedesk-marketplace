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

import { useEffect, useMemo, useRef } from 'preact/hooks';
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
  const { messages, sendMessage, sendKeys, isLoading, error } = useFleetChat('__main__', {
    messagesURL: '/api/main/messages',
    transcriptURL: '/api/main/transcript',
    sendURL: '/api/main/send',
    keysURL: '/api/main/keys',
  });
  const vRef = useRef<VirtuosoHandle | null>(null);
  const items = useMemo<RenderItem[]>(() => groupMessages(messages), [messages]);

  useEffect(() => {
    if (!vRef.current || items.length === 0) return;
    vRef.current.scrollToIndex({ index: items.length - 1, behavior: 'smooth' });
  }, [items.length]);

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
            followOutput="smooth"
            initialTopMostItemIndex={Math.max(0, items.length - 1)}
            computeItemKey={(_, it) => (it as RenderItem).key}
            itemContent={(_, it) => {
              const item = it as RenderItem;
              if (item.kind === 'toolGroup') return <ToolGroupCard messages={item.messages} />;
              return <MessageBubble msg={item.msg} onAnswerKeys={sendKeys} />;
            }}
            increaseViewportBy={{ top: 200, bottom: 800 }}
          />
        )}
      </div>
      <ChatComposer
        onSend={sendMessage}
        placeholder="reply to main shell (Enter sends, Shift+Enter newline)"
      />
    </div>
  );
}
