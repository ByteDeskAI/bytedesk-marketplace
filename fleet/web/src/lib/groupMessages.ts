// groupMessages.ts — fold runs of consecutive tool-only assistant
// messages into a single render item so chat-mode tiles don't
// pile up dozens of "CLAUDE / Bash DONE" rows for one tool burst.
//
// Grouping rule (BDM-33):
//   - A run of ≥2 consecutive `assistant` messages where EVERY part
//     in EVERY message is `tool-call` becomes one `toolGroup`.
//   - A single tool-only message stays as a normal `message`
//     (no UX win to wrapping one card + extra clicks).
//   - Any non-assistant message OR any assistant message containing
//     a `text` / `thinking` / `system` part breaks the run.
//
// Pure function — easy to lock down with table-driven tests.

import type { UIMessage } from '../api';

export type RenderItem =
  | { kind: 'message'; key: string; msg: UIMessage }
  | { kind: 'toolGroup'; key: string; messages: UIMessage[] };

const MIN_GROUP = 2;

export function groupMessages(messages: UIMessage[]): RenderItem[] {
  const out: RenderItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (isToolOnlyAssistant(m)) {
      // Scan forward as long as the streak holds.
      let j = i + 1;
      while (j < messages.length && isToolOnlyAssistant(messages[j])) j++;
      const run = messages.slice(i, j);
      if (run.length >= MIN_GROUP) {
        out.push({
          kind: 'toolGroup',
          key: `tg-${run[0].id}-${run[run.length - 1].id}`,
          messages: run,
        });
      } else {
        // Single tool-only message — render as normal bubble.
        out.push({ kind: 'message', key: run[0].id, msg: run[0] });
      }
      i = j;
      continue;
    }
    out.push({ kind: 'message', key: m.id, msg: m });
    i++;
  }
  return out;
}

function isToolOnlyAssistant(m: UIMessage): boolean {
  if (m.role !== 'assistant') return false;
  if (m.parts.length === 0) return false;
  return m.parts.every((p) => p.type === 'tool-call');
}

// Summary line for ToolGroupCard. Returns "Bash×2, Edit, TaskUpdate×2"
// truncated to maxNames distinct tools with `+N more` overflow.
export function summarizeToolGroup(messages: UIMessage[], maxNames = 6): string {
  const counts = new Map<string, number>();
  let total = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== 'tool-call') continue;
      total++;
      const name = p.tool_name || 'tool';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, maxNames).map(([name, c]) => (c > 1 ? `${name}×${c}` : name));
  const overflow = sorted.length - maxNames;
  if (overflow > 0) head.push(`+${overflow} more`);
  return `${total} tool${total === 1 ? '' : 's'} — ${head.join(', ')}`;
}
