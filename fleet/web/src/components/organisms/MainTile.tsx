// MainTile — always-present terminal in the multi-agent grid.
// Connects to the dashboard's persistent `fleet-main-<KEY>` tmux
// session via /api/main/pty. The main session survives dashboard
// restarts (tmux owns it) and gives the user a working shell rooted
// in the project worktree, regardless of how many fleet child
// sessions are running.
//
// Honors the global Terminal/Chat view mode (BDM-32). In chat mode,
// renders a structured-message view sourced from /api/main/messages
// + /api/main/transcript SSE. The composer is read-only for the
// main tile today (no /api/main/send endpoint yet) — the user can
// still attach via terminal mode to type into the persistent shell.

import { useEffect, useRef } from 'preact/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { InteractiveTerminal } from './InteractiveTerminal';
import { MessageBubble } from './MessageBubble';
import { useFleetChat } from '../../hooks/useFleetChat';
import { useViewMode } from '../../contexts/ViewModeContext';
import type { UIMessage } from '../../api';

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
  const { messages, isLoading, error } = useFleetChat('__main__', {
    messagesURL: '/api/main/messages',
    transcriptURL: '/api/main/transcript',
    sendURL: null,
  });
  const vRef = useRef<VirtuosoHandle | null>(null);

  useEffect(() => {
    if (!vRef.current || messages.length === 0) return;
    vRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div class="chat-tile">
      <div class="chat-tile__list">
        {error ? (
          <div class="chat-tile__error">failed to load: {error}</div>
        ) : isLoading && messages.length === 0 ? (
          <div class="chat-tile__loading">loading…</div>
        ) : messages.length === 0 ? (
          <div class="chat-tile__empty">no main-tile activity yet — switch to terminal mode to start one.</div>
        ) : (
          <Virtuoso
            ref={vRef}
            data={messages}
            followOutput="smooth"
            initialTopMostItemIndex={Math.max(0, messages.length - 1)}
            computeItemKey={(_, m) => (m as UIMessage).id}
            itemContent={(_, m) => <MessageBubble msg={m as UIMessage} />}
            increaseViewportBy={{ top: 200, bottom: 800 }}
          />
        )}
      </div>
      <div class="chat-tile__composer chat-tile__composer--readonly">
        <span class="chat-tile__readonly-note">main tile is read-only in chat mode — switch to terminal to type</span>
      </div>
    </div>
  );
}
