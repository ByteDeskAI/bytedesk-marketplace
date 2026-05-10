// MessageBubble — renders one UIMessage. Each part type gets its own
// renderer; tool-call parts may carry a sub-agent_id, in which case
// the host (ChatTile) renders a SubAgentThread inline below the part.
//
// Styling lives in styles.css (.message-bubble, .message-bubble__part,
// .message-bubble__tool, etc.). Variants:
//   compact — used inside sub-agent tabs in terminal mode where we
//             want a denser, mono-leaning look.

import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { UIMessage, UIPart } from '../../api';

export interface MessageBubbleProps {
  msg: UIMessage;
  variant?: 'default' | 'compact';
  /** Optional render-prop for tool-call parts that have a sub_agent_id —
   * lets the host (ChatTile) inject the nested SubAgentThread. */
  renderSubAgent?: (subAgentID: string, toolUseID: string) => ComponentChildren;
}

export function MessageBubble({ msg, variant = 'default', renderSubAgent }: MessageBubbleProps) {
  return (
    <article class={`message-bubble message-bubble--${msg.role} message-bubble--${variant}`}>
      <header class="message-bubble__role">{labelForRole(msg.role)}</header>
      <div class="message-bubble__parts">
        {msg.parts.map((p, i) => (
          <PartView key={i} part={p} renderSubAgent={renderSubAgent} />
        ))}
      </div>
    </article>
  );
}

function PartView({
  part,
  renderSubAgent,
}: {
  part: UIPart;
  renderSubAgent?: (subAgentID: string, toolUseID: string) => ComponentChildren;
}) {
  switch (part.type) {
    case 'text':
      return <div class="message-bubble__text">{part.text}</div>;
    case 'thinking':
      return <ThinkingView text={part.text || ''} />;
    case 'tool-call':
      return (
        <ToolCallView part={part}>
          {part.sub_agent_id && renderSubAgent
            ? renderSubAgent(part.sub_agent_id, part.tool_use_id || '')
            : null}
        </ToolCallView>
      );
    case 'tool-result':
      // Standalone tool-result (server failed to pair). Render compact.
      return (
        <div class="message-bubble__tool-result">
          <span class="message-bubble__tool-state">{part.state || 'done'}</span>
          <pre class="message-bubble__tool-output">{part.output}</pre>
        </div>
      );
    case 'system':
      return <div class={`message-bubble__system message-bubble__system--${part.subtype || 'note'}`}>{part.text}</div>;
    default:
      return null;
  }
}

function ThinkingView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div class={`message-bubble__thinking ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        class="message-bubble__thinking-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} thinking
      </button>
      {open ? <pre class="message-bubble__thinking-text">{text}</pre> : null}
    </div>
  );
}

function ToolCallView({ part, children }: { part: UIPart; children?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const stateClass = part.state ? `is-${part.state}` : 'is-running';
  const summary = part.tool_name === 'Task' && part.input?.subagent_type
    ? `Task → ${String(part.input.subagent_type)}`
    : part.tool_name || 'tool';
  return (
    <div class={`message-bubble__tool ${stateClass}`}>
      <button
        type="button"
        class="message-bubble__tool-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span class="message-bubble__tool-name">{summary}</span>
        <span class="message-bubble__tool-state">{part.state || 'running'}</span>
        <span class="message-bubble__tool-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div class="message-bubble__tool-body">
          {part.input ? (
            <pre class="message-bubble__tool-input">{JSON.stringify(part.input, null, 2)}</pre>
          ) : null}
          {part.output ? (
            <pre class={`message-bubble__tool-output ${part.state === 'error' ? 'is-error' : ''}`}>{part.output}</pre>
          ) : null}
        </div>
      )}
      {children}
    </div>
  );
}

function labelForRole(role: UIMessage['role']): string {
  switch (role) {
    case 'user':      return 'you';
    case 'assistant': return 'claude';
    case 'system':    return 'system';
    default:          return role;
  }
}
