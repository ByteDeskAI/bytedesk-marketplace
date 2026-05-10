// ChatTile — UI-mode body for one tile. Renders the session's
// projected UIMessages via react-virtuoso for sticky-bottom autoscroll
// and lazy DOM construction (jsonl can hit 30MB and 1000s of turns).
//
// A textarea composer at the bottom POSTs to the existing
// /api/sessions/<T>/send endpoint (which wraps `tmux send-keys`) so
// users can reply / interject without leaving chat mode.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useFleetChat } from '../../hooks/useFleetChat';
import { useSessionStats } from '../../hooks/useSessionStats';
import { MessageBubble } from './MessageBubble';
import { SubAgentThread } from './SubAgentThread';
import type { SessionRow, UIMessage } from '../../api';

export interface ChatTileProps {
  row: SessionRow;
}

export function ChatTile({ row }: ChatTileProps) {
  const { messages, sendMessage, isLoading, error } = useFleetChat(row.ticket);
  const { stats } = useSessionStats(row.ticket);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const vRef = useRef<VirtuosoHandle | null>(null);

  // Sub-agent index — Task tool_use_id → agent_id, so the renderer
  // can look up which nested SubAgentThread to render under each
  // tool-call. We prefer the explicit mapping from stats.sub_agents
  // (where each entry's agent_id is canonical) but fall back to the
  // Task input's `subagent_type` when the stats haven't caught up.
  const subAgentIDs = useMemo(() => {
    const set = new Set<string>();
    for (const sa of stats?.sub_agents ?? []) set.add(sa.agent_id);
    return set;
  }, [stats?.sub_agents]);

  // Stick to bottom on new messages.
  useEffect(() => {
    if (!vRef.current) return;
    if (messages.length === 0) return;
    vRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
  }, [messages.length]);

  const composerDisabled = sending || row.state === 'starting';

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setSendErr(null);
    try {
      await sendMessage(text);
      setDraft('');
    } catch (e) {
      setSendErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
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
            data={messages}
            followOutput="smooth"
            initialTopMostItemIndex={Math.max(0, messages.length - 1)}
            computeItemKey={(_, m) => (m as UIMessage).id}
            itemContent={(_, m) => (
              <MessageBubble
                msg={m as UIMessage}
                renderSubAgent={(subID) =>
                  subAgentIDs.has(subID) ? (
                    <SubAgentThread ticket={row.ticket} agentID={subID} />
                  ) : null
                }
              />
            )}
            increaseViewportBy={{ top: 200, bottom: 800 }}
          />
        )}
      </div>
      <form
        class="chat-tile__composer"
        onSubmit={(e) => { e.preventDefault(); void onSend(); }}
      >
        <textarea
          class="chat-tile__input"
          rows={1}
          value={draft}
          placeholder={
            row.state === 'starting'
              ? 'session starting…'
              : `reply to ${row.ticket} (Enter sends, Shift+Enter newline)`
          }
          disabled={composerDisabled}
          onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown as any}
        />
        <button
          type="submit"
          class="chat-tile__send"
          disabled={composerDisabled || !draft.trim()}
          title="Send (Enter)"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
      {sendErr ? <div class="chat-tile__send-err">{sendErr}</div> : null}
    </div>
  );
}
