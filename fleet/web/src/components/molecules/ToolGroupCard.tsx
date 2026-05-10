// ToolGroupCard — collapsed-by-default summary for a streak of
// consecutive tool-only assistant messages (BDM-33). Click to expand
// and see each individual tool-call card stacked.
//
// Single CLAUDE label at the top so a 6-tool burst feels like one
// turn of activity rather than six separate bubbles.

import { useState } from 'preact/hooks';
import { MessageBubble } from '../organisms/MessageBubble';
import { summarizeToolGroup } from '../../lib/groupMessages';
import type { UIMessage } from '../../api';

export interface ToolGroupCardProps {
  messages: UIMessage[];
  showRole?: boolean;
}

export function ToolGroupCard({ messages, showRole = true }: ToolGroupCardProps) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolGroup(messages);
  return (
    <article class={`tool-group ${open ? 'is-open' : ''}`}>
      {showRole ? <header class="tool-group__role">claude</header> : null}
      <button
        type="button"
        class="tool-group__toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span class="tool-group__chev">{open ? '▾' : '▸'}</span>
        <span class="tool-group__summary">{summary}</span>
      </button>
      {open && (
        <div class="tool-group__body">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} variant="compact" />
          ))}
        </div>
      )}
    </article>
  );
}
