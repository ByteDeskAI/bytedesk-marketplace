// SubAgentThread — nested chat thread for a sub-agent. Rendered
// inline under the parent's `Task` tool-call card in chat mode so
// the conversation reads as one continuous flow with visible nesting.
//
// Sub-agents have no separate input channel (they share the parent's
// tmux pane), so this view is read-only — no composer.

import { useFleetChat } from '../../hooks/useFleetChat';
import { MessageBubble } from './MessageBubble';

export interface SubAgentThreadProps {
  ticket: string;
  agentID: string;
}

export function SubAgentThread({ ticket, agentID }: SubAgentThreadProps) {
  const { messages, isLoading, error } = useFleetChat(ticket, { agentID, limit: 100 });

  return (
    <section class="sub-agent-thread" aria-label={`sub-agent ${agentID}`}>
      <header class="sub-agent-thread__header">
        <span class="sub-agent-thread__rail" aria-hidden="true" />
        <span class="sub-agent-thread__label">@{agentID}</span>
        {isLoading ? <span class="sub-agent-thread__loading">…</span> : null}
      </header>
      {error ? (
        <div class="sub-agent-thread__error">{error}</div>
      ) : (
        <div class="sub-agent-thread__body">
          {messages.length === 0 && !isLoading ? (
            <div class="sub-agent-thread__empty">no activity yet</div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} variant="compact" />)
          )}
        </div>
      )}
    </section>
  );
}
