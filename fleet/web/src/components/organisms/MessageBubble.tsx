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
import { renderMarkdown } from '../../lib/markdown';
import { AskUserQuestionCard } from '../molecules/AskUserQuestionCard';
import { getToolVisualizer } from '../visualizers';

export interface MessageBubbleProps {
  msg: UIMessage;
  variant?: 'default' | 'compact';
  /** Optional render-prop for tool-call parts that have a sub_agent_id —
   * lets the host (ChatTile) inject the nested SubAgentThread. */
  renderSubAgent?: (subAgentID: string, toolUseID: string) => ComponentChildren;
  /** Optional callback to submit AskUserQuestion answers as a tmux key
   * stream. ChatTile / MainChatBody pass through useFleetChat.sendKeys. */
  onAnswerKeys?: (keys: string[]) => Promise<void>;
  /** Show the role chip (CLAUDE / YOU). Hosts pass false on continued
   * messages within the same role-streak to reduce visual noise. */
  showRole?: boolean;
}

export function MessageBubble({ msg, variant = 'default', renderSubAgent, onAnswerKeys, showRole = true }: MessageBubbleProps) {
  // Tool-only assistant messages don't need a role chip — the tool
  // card itself carries identity (Bash / Edit / Read / …).
  const onlyToolParts = msg.parts.length > 0 && msg.parts.every((p) => p.type === 'tool-call' || p.type === 'tool-result');
  const renderRole = showRole && !(msg.role === 'assistant' && onlyToolParts) && msg.role !== 'system';
  return (
    <article class={`message-bubble message-bubble--${msg.role} message-bubble--${variant}${renderRole ? ' message-bubble--show-role' : ''}`}>
      {renderRole ? <header class="message-bubble__role">{labelForRole(msg.role)}</header> : null}
      <div class="message-bubble__parts">
        {msg.parts.map((p, i) => (
          <PartView key={i} part={p} renderSubAgent={renderSubAgent} onAnswerKeys={onAnswerKeys} />
        ))}
      </div>
    </article>
  );
}

function PartView({
  part,
  renderSubAgent,
  onAnswerKeys,
}: {
  part: UIPart;
  renderSubAgent?: (subAgentID: string, toolUseID: string) => ComponentChildren;
  onAnswerKeys?: (keys: string[]) => Promise<void>;
}) {
  switch (part.type) {
    case 'text':
      return (
        <div
          class="message-bubble__text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text || '') }}
        />
      );
    case 'thinking':
      return <ThinkingView text={part.text || ''} />;
    case 'tool-call': {
      if (part.tool_name === 'AskUserQuestion' && onAnswerKeys) {
        return <AskUserQuestionCard part={part} onSubmit={onAnswerKeys} />;
      }
      // Specialized per-tool visualizer (BDM-34). Falls back to the
      // generic ToolCallView if the registry has no entry — that
      // path is the original input/output JSON dump.
      const Viz = getToolVisualizer(part.tool_name || '');
      if (Viz) {
        return (
          <>
            {Viz({
              toolName: part.tool_name || '',
              toolUseId: part.tool_use_id || '',
              input: (part.input as Record<string, unknown>) || {},
              output: part.output,
              state: part.state,
            })}
            {part.sub_agent_id && renderSubAgent
              ? renderSubAgent(part.sub_agent_id, part.tool_use_id || '')
              : null}
          </>
        );
      }
      return (
        <ToolCallView part={part}>
          {part.sub_agent_id && renderSubAgent
            ? renderSubAgent(part.sub_agent_id, part.tool_use_id || '')
            : null}
        </ToolCallView>
      );
    }
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
