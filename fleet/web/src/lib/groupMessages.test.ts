// groupMessages.test.ts — table-driven tests for the chat-mode
// grouping logic. Run with:
//   node --experimental-strip-types --test src/lib/groupMessages.test.ts
//
// Pure function under test; no DOM, no preact. Built-in node:test +
// node:assert keep the dep graph empty.

import test from 'node:test';
import { strict as assert } from 'node:assert';
import { groupMessages, summarizeToolGroup, type RenderItem } from './groupMessages.ts';
import type { UIMessage, UIPart } from '../api.ts';

function tool(name: string): UIPart {
  return { type: 'tool-call', tool_name: name, tool_use_id: `tu-${name}-${Math.random()}`, state: 'done' };
}
function text(t: string): UIPart {
  return { type: 'text', text: t };
}
function makeMsg(id: string, role: UIMessage['role'], parts: UIPart[]): UIMessage {
  return { id, role, timestamp: '2026-05-10T00:00:00Z', parts };
}

test('three consecutive tool-only assistant messages → one group', () => {
  const msgs: UIMessage[] = [
    makeMsg('a1', 'assistant', [tool('Bash')]),
    makeMsg('a2', 'assistant', [tool('Edit')]),
    makeMsg('a3', 'assistant', [tool('Bash')]),
  ];
  const items = groupMessages(msgs);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'toolGroup');
  if (items[0].kind === 'toolGroup') {
    assert.equal(items[0].messages.length, 3);
  }
});

test('single tool-only message stays as message (below MIN_GROUP)', () => {
  const msgs: UIMessage[] = [
    makeMsg('u1', 'user', [text('hi')]),
    makeMsg('a1', 'assistant', [tool('Bash')]),
    makeMsg('u2', 'user', [text('bye')]),
  ];
  const items = groupMessages(msgs);
  assert.equal(items.length, 3);
  assert.equal(items.every((it: RenderItem) => it.kind === 'message'), true);
});

test('text part breaks the run', () => {
  const msgs: UIMessage[] = [
    makeMsg('a1', 'assistant', [tool('Bash')]),
    makeMsg('a2', 'assistant', [tool('Edit')]),
    makeMsg('a3', 'assistant', [text('explanation')]),
    makeMsg('a4', 'assistant', [tool('Bash')]),
    makeMsg('a5', 'assistant', [tool('Bash')]),
  ];
  const items = groupMessages(msgs);
  // [group of 2] + [text msg] + [group of 2]
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, 'toolGroup');
  assert.equal(items[1].kind, 'message');
  assert.equal(items[2].kind, 'toolGroup');
});

test('user message between tool runs splits them', () => {
  const msgs: UIMessage[] = [
    makeMsg('a1', 'assistant', [tool('Bash')]),
    makeMsg('a2', 'assistant', [tool('Bash')]),
    makeMsg('u1', 'user', [text('continue')]),
    makeMsg('a3', 'assistant', [tool('Edit')]),
    makeMsg('a4', 'assistant', [tool('Edit')]),
  ];
  const items = groupMessages(msgs);
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, 'toolGroup');
  assert.equal(items[1].kind, 'message');
  assert.equal(items[2].kind, 'toolGroup');
});

test('mixed message (text + tool-call) is NOT in any group', () => {
  const msgs: UIMessage[] = [
    makeMsg('a1', 'assistant', [tool('Bash')]),
    makeMsg('a2', 'assistant', [text('mixed'), tool('Edit')]),
    makeMsg('a3', 'assistant', [tool('Bash')]),
  ];
  const items = groupMessages(msgs);
  // Three separate items; no group because no streak of 2+ consecutive
  // tool-only messages.
  assert.equal(items.length, 3);
  assert.equal(items.every((it: RenderItem) => it.kind === 'message'), true);
});

test('summarizeToolGroup tallies counts and overflow', () => {
  const msgs: UIMessage[] = [
    makeMsg('a1', 'assistant', [tool('Bash')]),
    makeMsg('a2', 'assistant', [tool('Bash')]),
    makeMsg('a3', 'assistant', [tool('Edit')]),
    makeMsg('a4', 'assistant', [tool('TaskUpdate'), tool('TaskUpdate')]),
    makeMsg('a5', 'assistant', [tool('Write')]),
  ];
  const summary = summarizeToolGroup(msgs);
  // Counts: Bash×2, TaskUpdate×2, Edit×1, Write×1 → total 6 tools
  assert.match(summary, /6 tools/);
  assert.match(summary, /Bash×2/);
  assert.match(summary, /TaskUpdate×2/);
});

test('summarizeToolGroup truncates with +N more', () => {
  const parts = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => tool(n));
  const msgs: UIMessage[] = [makeMsg('a1', 'assistant', parts)];
  const summary = summarizeToolGroup(msgs, 3);
  assert.match(summary, /\+5 more/);
});
