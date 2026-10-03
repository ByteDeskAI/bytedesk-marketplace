// TM-310 round 2: the per-agent grants against the REAL EP-026 code paths (handoff, events mirror and
// diagnose, work queue, fenced claims). Each agent is a child process holding only AO_CREDS_SOCK, opening the
// real transport. Every positive prints its result, every negative prints the server's refusal, and the
// mutation test shows the negatives fail when the grants are opened.
import assert from 'node:assert/strict';
import test from 'node:test';
import { REPO, asAgent, openUpPermissions, startServer } from '../helpers/agent-creds-fixture.mjs';
import { agentPermissions, loadAgentUsers } from '../../topology/lib/agent-creds.mjs';
import { serverConfig } from '../../topology/lib/nats-local.mjs';

const AGENTS = ['agentA', 'agentB', 'boss', 'rev'];

async function setup() {
  const server = await startServer({ agents: AGENTS });
  const mk = (agent, role, extra = {}) => server.store.provision({ repo: REPO, agent, role, mailTo: role === 'lead' ? ['agentA', 'agentB', 'rev'] : ['boss'], extra: { token: `tok-${agent}` }, ...extra });
  const lead = await mk('boss', 'lead');
  const a = await mk('agentA', 'worker', { takesWork: true });
  const b = await mk('agentB', 'worker');
  const rev = await mk('rev', 'reviewer');
  await new Promise((r) => setTimeout(r, 500));
  return { server, lead, a, b, rev };
}

const show = (label, results) => console.log(`${label}: ${JSON.stringify(results)}`);
const wire = (r) => [r.error, ...r.refusals].filter(Boolean).join(' | ');

const HANDOFF_A = `
await step('handoff (A closes its own message to boss)', () => handoff({ transport: t, repo: ${JSON.stringify(REPO)}, messageId: 'm1', from: 'agentA', reason: 'handed_off_to', to: 'boss',
  send: async ({ plannedId }) => { await t.publishMail({ repo: ${JSON.stringify(REPO)}, agent: 'boss', messageId: plannedId, body: 'handoff body' }); return { id: plannedId }; },
  close: async () => {}, probe: async () => false }).then((r) => ({ state: r.state, successor: r.successorId })));
await step('read own handoff record', () => t.getHandoff({ repo: ${JSON.stringify(REPO)}, messageId: 'm1' }).then((r) => r && JSON.parse(r.body).data.state));
await step('publish an event', () => t.publishEvent({ repo: ${JSON.stringify(REPO)}, kind: 'message.sent', body: JSON.stringify({ schema: 1, type: 'ao/event', id: 'e', data: { type: 'message.sent', id: 'm1', from: 'agentA', to: ['boss'], ts: new Date().toISOString() }, meta: {} }) }).then((r) => r.seq));`;

const B_ATTACKS = `
await step('B writes A\\'s handoff record', () => t.createHandoff({ repo: ${JSON.stringify(REPO)}, messageId: 'm1', agent: 'agentA', body: '{"forged":true}' }));
await step('B overwrites A\\'s handoff by update', () => t.updateHandoff({ repo: ${JSON.stringify(REPO)}, messageId: 'm1', agent: 'agentA', body: '{"forged":true}', expectedRevision: 1 }));
await step('B reads the events stream (diagnose)', () => readRepoEvents(t, ${JSON.stringify(REPO)}, { limit: 10 }).then((e) => e.length));
await step('B watches repo events', async () => { const w = await t.watch({ repo: ${JSON.stringify(REPO)} }); await t.publishEvent({ repo: ${JSON.stringify(REPO)}, kind: 'probe', body: '{}' }); const changed = await w.changed(1000); w.stop(); return changed; });
await step('B publishes work', () => publishWork({ transport: t, repo: ${JSON.stringify(REPO)}, task: 'TM-9' }));
await step('B takes work', () => takeWork({ transport: t, repo: ${JSON.stringify(REPO)}, worker: 'agentB', ttlMs: 60000, timeoutMs: 500 }));
await step('B publishes an event (allowed: every agent journals)', () => t.publishEvent({ repo: ${JSON.stringify(REPO)}, kind: 'message.sent', body: '{}' }).then((r) => r.seq));`;

test('grants: handoff, events, work queue and fenced claims, per role, with a negative for each', { timeout: 300000 }, async () => {
  const { server, lead, a, b, rev } = await setup();
  try {
    // --- positives -------------------------------------------------------------------------------
    const A = await asAgent(server, a.holder, `${HANDOFF_A}
await step('publish work (worker, must be refused)', () => publishWork({ transport: t, repo: ${JSON.stringify(REPO)}, task: 'TM-8' }));`);
    show('A (worker, takes work)', A.results);
    assert.deepEqual(A.results['handoff (A closes its own message to boss)'].value, { state: 'closed', successor: 'handoff-m1' });
    assert.equal(A.results['read own handoff record'].value, 'closed');
    assert.equal(A.results['publish an event'].ok, true);
    assert.equal(A.results['publish work (worker, must be refused)'].ok, false, 'a worker published work');
    assert.match(wire(A.results['publish work (worker, must be refused)']), /Permissions Violation/);

    const L = await asAgent(server, lead.holder, `
await step('lead publishes work', () => publishWork({ transport: t, repo: ${JSON.stringify(REPO)}, task: 'TM-1' }).then(() => 'TM-1'));
await step('lead reads events', () => readRepoEvents(t, ${JSON.stringify(REPO)}, { limit: 50 }).then((e) => e.map((x) => x.type)));
await step('lead diagnose (parked/done-unseen)', async () => diagnose(await readRepoEvents(t, ${JSON.stringify(REPO)}, { limit: 50 }), { idleAgents: ['boss'] }));
await step('lead reads A\\'s handoff record', () => t.getHandoff({ repo: ${JSON.stringify(REPO)}, messageId: 'm1', agent: 'agentA' }).then((r) => r && JSON.parse(r.body).data.state));
await step('lead probes mail stream (MSG.GET)', () => t.hasMailMessage({ repo: ${JSON.stringify(REPO)}, agent: 'boss', messageId: 'handoff-m1' }));
await step('lead watches events', async () => { const w = await t.watch({ repo: ${JSON.stringify(REPO)} }); await t.publishEvent({ repo: ${JSON.stringify(REPO)}, kind: 'x', body: '{}' }); const c = await w.changed(1500); w.stop(); return c; });`);
    show('lead', L.results);
    assert.equal(L.results['lead publishes work'].ok, true);
    assert.ok(L.results['lead reads events'].value.includes('message.sent'));
    assert.equal(L.results['lead reads A\'s handoff record'].value, 'closed');
    assert.equal(L.results['lead probes mail stream (MSG.GET)'].value, true, 'the lead can prove the successor exists');
    assert.equal(L.results['lead watches events'].value, true);
    assert.equal(L.results['lead diagnose (parked/done-unseen)'].ok, true);

    const W = await asAgent(server, a.holder, `
await step('A takes work + fenced write', async () => {
  const took = await takeWork({ transport: t, repo: ${JSON.stringify(REPO)}, worker: 'agentA', ttlMs: 60000, timeoutMs: 1500 });
  if (!took.took) return { took };
  const next = await writeFenced({ transport: t, repo: ${JSON.stringify(REPO)}, task: took.task, token: took.token, owner: 'agentA', patch: { note: 'working' } });
  let stale = null; try { await writeFenced({ transport: t, repo: ${JSON.stringify(REPO)}, task: took.task, token: took.token, owner: 'agentA' }); } catch (e) { stale = e.code + ': ' + e.message; }
  return { task: took.task, first: took.token.revision, second: next.revision, stale };
});`);
    show('A takes work', W.results);
    const took = W.results['A takes work + fenced write'].value;
    assert.equal(took.task, 'TM-1');
    assert.ok(took.second > took.first);
    assert.match(took.stale, /TOPOLOGY_CLAIM_FENCED/);

    const R = await asAgent(server, rev.holder, `
await step('reviewer reads events', () => readRepoEvents(t, ${JSON.stringify(REPO)}, { limit: 10 }).then((e) => e.length));
await step('reviewer publishes work (refused)', () => publishWork({ transport: t, repo: ${JSON.stringify(REPO)}, task: 'TM-7' }));`);
    show('reviewer', R.results);
    assert.equal(R.results['reviewer reads events'].ok, true);
    assert.equal(R.results['reviewer publishes work (refused)'].ok, false);

    // --- negatives: B, a plain worker -------------------------------------------------------------
    const B = await asAgent(server, b.holder, B_ATTACKS);
    show('B (plain worker)', B.results);
    for (const name of ['B writes A\'s handoff record', 'B overwrites A\'s handoff by update', 'B reads the events stream (diagnose)', 'B publishes work', 'B takes work']) {
      assert.equal(B.results[name].ok, false, `B was NOT refused: ${name}`);
      console.log(`REFUSED  ${name}: ${wire(B.results[name])}`);
    }
    assert.equal(B.results['B watches repo events'].value, false, 'B must not receive repo events');
    console.log(`REFUSED  B watches repo events: ${wire(B.results['B watches repo events'])}`);
    assert.match(wire(B.results['B watches repo events']), /PERMISSIONS_VIOLATION/);
    assert.equal(B.results['B publishes an event (allowed: every agent journals)'].ok, true);

    // Server-side truth, not B's story: A's record is untouched, and no forged work reached the queue.
    const record = await server.transport.getHandoff({ repo: REPO, messageId: 'm1', agent: 'agentA' });
    assert.equal(JSON.parse(record.body).data.state, 'closed');
    assert.doesNotMatch(record.body, /forged/);
    const tasks = await server.jsm.streams.info('ORCH_TASKS');
    console.log(`ORCH_TASKS after B: messages=${tasks.state.messages} (TM-1 was consumed by A; TM-9 and TM-8 must not exist)`);
    assert.equal(tasks.state.messages, 0);
  } finally {
    for (const holder of [lead.holder, a.holder, b.holder, rev.holder]) await holder.revoke().catch(() => {});
    await server.stop();
  }
});

test('mutation: with B\'s grants opened the same attacks succeed, so the negatives above can fail', { timeout: 300000 }, async () => {
  const { server, lead, a, b, rev } = await setup();
  try {
    await asAgent(server, a.holder, HANDOFF_A);
    await openUpPermissions(server, b.issued, { serverConfig, loadAgentUsers });
    const B = await asAgent(server, b.holder, B_ATTACKS.split('\n').filter((line) => !/takes work/.test(line)).join('\n'));
    show('MUTATED B', B.results);
    assert.equal(B.results['B reads the events stream (diagnose)'].ok, true);
    assert.equal(B.results['B publishes work'].ok, true);
    assert.equal(B.results['B watches repo events'].value, true);
    assert.equal(B.results['B writes A\'s handoff record'].ok, true, 'with the grant opened B can write A\'s record (create may report exists, but must not be refused)');
  } finally {
    for (const holder of [lead.holder, a.holder, b.holder, rev.holder]) await holder.revoke().catch(() => {});
    await server.stop();
  }
});

test('permission shape: only the lead writes tasks.ready; only overseers read events; handoff keys are per-agent', () => {
  const base = { repo: REPO, inboxPrefix: '_INBOX.x', mailTo: ['boss'] };
  const grants = (role, extra = {}) => agentPermissions({ ...base, agent: 'agentA', role, ...extra });
  assert.ok(grants('lead').publish.allow.includes(`orch.${REPO}.tasks.ready`));
  assert.ok(!grants('worker').publish.allow.includes(`orch.${REPO}.tasks.ready`));
  assert.ok(grants('reviewer').publish.allow.includes('$JS.API.STREAM.MSG.GET.ORCH_EVENTS'));
  assert.ok(!grants('worker').publish.allow.includes('$JS.API.STREAM.MSG.GET.ORCH_EVENTS'));
  assert.ok(grants('worker').publish.allow.includes(`$KV.ORCH_HANDOFFS.${REPO}.agentA.>`));
  assert.ok(!grants('worker').publish.allow.some((s) => s.startsWith('$KV.ORCH_CLAIMS')), 'a plain worker writes no claim');
  assert.ok(grants('worker', { takesWork: true }).publish.allow.some((s) => s.startsWith('$KV.ORCH_CLAIMS')));
});
