import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyGoalObligation } from '../../topology/lib/goal-loop-notify.mjs';

function fixture() {
  const binding = { serverKey: 'fixture-server', serverPid: 1, sessionId: '$1', sessionCreated: 2, paneId: '%1', panePid: 3 };
  const loop = { consumer: '/fixture', repository: { id: '/fixture/.git' }, leadId: 'lead', obligation: { id: 'stable-obligation' } };
  const record = { agent_id: 'lead', repo_id: '/fixture/.git', pane: '%1', binding, provider: 'fixture' };
  let sends = 0;
  return { loop, record, get sends() { return sends; }, options: { readLead: async () => ({ record }), loadAdapters: async () => new Map([['fixture', { id: 'fixture', composer: { empty_tmux_pattern: '^ready$' }, failure_patterns: [] }]]), wake: async input => { sends++; assert.deepEqual(input.binding, binding); assert.match(input.text, /stable-obligation/); return { rang: true }; } } };
}
test('safe lead notification is stable per obligation and observed incarnation', async () => {
  const f = fixture();
  f.loop.obligation.notification = await notifyGoalObligation({ loop: f.loop, ...f.options }); assert.equal(f.loop.obligation.notification.state, 'sent');
  await notifyGoalObligation({ loop: f.loop, ...f.options }); assert.equal(f.sends, 1);
  f.record.binding.panePid++; await notifyGoalObligation({ loop: f.loop, ...f.options }); assert.equal(f.sends, 2);
});
test('wrong recipient and occupied composer never claim engagement', async () => {
  const f = fixture(); f.record.agent_id = 'replacement';
  assert.equal((await notifyGoalObligation({ loop: f.loop, ...f.options })).state, 'held'); assert.equal(f.sends, 0);
  f.record.agent_id = 'lead'; f.options.wake = async () => ({ rang: false, reason: 'composer contains a draft' });
  const notification = await notifyGoalObligation({ loop: f.loop, ...f.options }); assert.equal(notification.state, 'held'); assert.match(notification.reason, /draft/);
});
