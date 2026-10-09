// TM-478 / TM-402. A lead's readiness probe must not pile up in its pane, an undelivered probe's
// expiry is not evidence against the lead, a lead that keeps answering is asked less often, and the
// ring addresses the lead's own tmux server. No test here touches a real tmux server: the bell runs
// against a stub, and the server test records argv through a shim command that never execs tmux.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composerFormat, wakeForProbe } from '../../topology/lib/delivery.mjs';
import { leadNonceAck, leadRegistryDir, leadState, responsiveForTest, responsiveTtlMs, ringLeadPane } from '../../topology/lib/lead.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { resumeStandingMessages, sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import * as tmux from '../../topology/lib/tmux.mjs';
import { exists, readJson, run, sleep, writeJson } from '../../topology/lib/util.mjs';

const BINDING = { serverKey: '/isolated/tm478', serverPid: 100, sessionId: '$1', sessionCreated: 200, paneId: '%2', panePid: 300 };
const ADAPTER = { id: 'claude', submit_keys: ['Enter'], composer: { empty_tmux_pattern: '^\\s*[>❯]\\s*$' }, failure_patterns: [] };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-tm478-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', consumer]);
  const env = { XDG_CONFIG_HOME: join(home, '.config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_AGENT_ID: 'lead0001' };
  const identity = await canonicalRepoId(consumer);
  const registryDir = leadRegistryDir(env, home);
  const record = { repo_id: identity.id, agent_id: 'lead0001', session: 'lead', pane: BINDING.paneId, consumer, provider: 'claude', binding: { ...BINDING } };
  const recordPath = join(registryDir, `${repoKey(identity.id)}.json`);
  return { root, consumer, home, env, record, recordPath, registryDir, dir: join(registryDir, 'probes') };
}

/** A pane whose composer is empty until something is typed, and then holds it: Enter did not submit. */
function stickyComposer() {
  let draft = '';
  const sent = [];
  return {
    sent,
    async tmux(args) {
      if (args[0] === 'display-message') return { code: 0, stdout: `${draft ? 0 : 1}|0|0|` };
      return { code: 0, stdout: '' };
    },
    async listServerPanes() { return [{ ...BINDING, alive: true }]; },
    async capture() { return draft ? `> ${draft}` : '>'; },
    async sendText(pane, text) { sent.push(text); draft += text; },
  };
}

const probeFiles = async (dir) => (await readdir(dir)).filter((name) => name.endsWith('.json') && !name.includes('.ack.') && !name.startsWith('lead0001.'));

test('a second probe does not stack in a non-empty composer: the pending probe is extended, never re-typed', async (t) => {
  const f = await fixture(t);
  const pane = stickyComposer();
  const wake = (record, nonce) => wakeForProbe({ pane: record.pane, adapter: ADAPTER, format: composerFormat(ADAPTER, null), binding: record.binding, tmux: pane, settleMs: 0, text: `AO_PROBE ${nonce}` });
  const misses = [];
  const options = { registryDir: f.registryDir, alive: async () => true, wake, onMiss: (miss) => misses.push(miss) };
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.equal(pane.sent.length, 1, 'the first probe is typed');
  const [first] = await probeFiles(f.dir);
  const firstProbe = await readJson(join(f.dir, first));
  for (let i = 0; i < 3; i += 1) assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.equal(pane.sent.length, 1, 'three more callers typed nothing: the composer still holds the first pointer');
  assert.deepEqual(await probeFiles(f.dir), [first], 'one probe file, the same nonce, for every caller');
  assert.ok((await readJson(join(f.dir, first))).expires_at > firstProbe.expires_at, 'each caller extends the pending probe so its ack stays acceptable');
  assert.deepEqual(misses.map((miss) => miss.undelivered), [true, true, true, true]);
});

test('a probe whose ring typed nothing is re-rung under the SAME nonce, not a second one', async (t) => {
  const f = await fixture(t);
  const nonces = [];
  let outcome = { rang: false, reason: 'the composer is not empty' };
  const options = { registryDir: f.registryDir, alive: async () => true, wake: async (_record, nonce) => { nonces.push(nonce); return outcome; } };
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  outcome = { rang: true, submitted: true };
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.equal(nonces.length, 2, 'rung again only because nothing was typed the first time; never after a landed ring');
  assert.equal(nonces[0], nonces[1]);
  // A pointer lost from the pane is replaced once a full window has passed, still under the same nonce.
  const lastPath = join(f.registryDir, 'probe-state', 'lead0001.last-probe.json');
  await writeJson(lastPath, { ...await readJson(lastPath), at: Date.now() - 200_000 });
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.deepEqual([nonces.length, nonces[2]], [3, nonces[0]]);
  assert.equal((await readJson(lastPath)).rings, 2, 'and the next replacement waits twice as long');
});

test('callers sharing one probe all see the answer: the one that consumes the ack does not leave the others unresponsive', async (t) => {
  const f = await fixture(t);
  let rings = 0;
  const wake = async (_record, nonce) => {
    rings += 1;
    setTimeout(async () => { await writeJson(join(f.dir, `${nonce}.ack.json`), await readJson(join(f.dir, `${nonce}.json`))); }, 400);
    return { rang: true, submitted: true };
  };
  const options = { registryDir: f.registryDir, alive: async () => true, wake };
  const results = await Promise.all([responsiveForTest(f.record, 3000, options), responsiveForTest(f.record, 3000, options), responsiveForTest(f.record, 3000, options)]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(rings, 1, 'one ring for three callers');
  assert.equal((await readJson(join(f.dir, 'lead0001.answered.json'))).streak, 1, 'the recorded answer survives the other waiters');
});

test('two waiters on one probe both see the answer even when the consumer stalls after removing it', async (t) => {
  const f = await fixture(t);
  let nonce = null, stalled = false;
  // The first liveness check made after the probe file is gone stalls. Before the fix that was the
  // consuming waiter's own check, made after the lock and BEFORE it recorded the answer; the other
  // waiter, seeing the probe gone, found no memo and reported the lead unresponsive.
  const alive = async () => {
    if (nonce && !stalled && !await exists(join(f.dir, `${nonce}.json`))) { stalled = true; await sleep(1500); }
    return true;
  };
  const wake = async (_record, minted) => {
    nonce = minted;
    setTimeout(async () => { await writeJson(join(f.dir, `${minted}.ack.json`), await readJson(join(f.dir, `${minted}.json`))); }, 400);
    return { rang: true, submitted: true };
  };
  const options = { registryDir: f.registryDir, alive, wake };
  const first = responsiveForTest(f.record, 3000, options);
  await sleep(250);
  const results = await Promise.all([first, responsiveForTest(f.record, 3000, options)]);
  assert.deepEqual(results, [true, true]);
  assert.equal((await readJson(join(f.dir, 'lead0001.answered.json'))).streak, 1, 'one answer, one step of backoff');
  assert.ok(!(await readdir(f.dir)).some((name) => name.includes('last-probe')), 'the ring memo is not in probes/');
});

test('an ack with no waiter left still releases held mail after its probe expires', async (t) => {
  const f = await fixture(t);
  const source = join(f.root, 'source');
  await run('git', ['init', source]);
  await writeJson(f.recordPath, f.record);
  await writeJson(join(agentsRoot(f.consumer), 'lead0001', 'agent.json'), { id: 'lead0001', role: 'lead', full_name: 'lead0001' });
  const ready = { status: 'responsive', record: { agent_id: 'send0001' }, library_lead: 'send0001' };
  const probes = { alive: async () => true };
  const opts = { env: f.env, home: f.home,
    readiness: async (o) => o.consumer === source ? ready : leadState({ ...o, probes }),
    requestRecovery: async () => {}, activate: async () => ({ enrollment: { enrolled: true } }), enrollment: async () => ({ enrolled: true }) };
  // A delivered probe nobody answered in time: the lead reads unresponsive and the mail is held.
  assert.equal(await responsiveForTest(f.record, 30, { registryDir: f.registryDir, alive: probes.alive, wake: async () => ({ rang: true, submitted: true }) }), false);
  const [probe] = await probeFiles(f.dir);
  const nonce = probe.slice(0, -'.json'.length);
  const message = { id: 'held-for-ack', consumer: f.consumer, fromProject: source, from: 'send0001', to: 'lead0001', body: 'body' };
  const held = await sendStandingMessage(message, opts);
  assert.deepEqual([held.status, held.reason], ['held', 'leads_not_ready']);
  assert.ok(held.next_retry_at, 'held on a backoff');
  // The lead answers at its next turn boundary. No waiter is running.
  const acked = await leadNonceAck({ consumer: f.consumer, nonce, env: f.env, home: f.home, alive: probes.alive });
  assert.deepEqual(acked.woken, ['held-for-ack'], 'the ack makes the held mail due now');
  // The probe then expires and is swept, taking the ack with it.
  await rm(join(f.dir, `${nonce}.json`)); await rm(join(f.dir, `${nonce}.ack.json`));
  const [resumed] = await resumeStandingMessages({ consumer: f.consumer, ...opts });
  assert.equal(resumed?.status, 'delivered', JSON.stringify(resumed));
  assert.equal(resumed.delivered_to, 'lead0001');
});

test('an undelivered or unsubmitted probe leaves the lead unproven, never unresponsive; a delivered one does not', async (t) => {
  for (const [outcome, expected] of [
    [{ rang: false, reason: 'the composer is not empty' }, 'unproven'],
    [{ rang: true, submitted: false }, 'unproven'],
    [{ rang: true, submitted: true }, 'unresponsive'],
  ]) {
    const f = await fixture(t);
    await writeJson(f.recordPath, f.record);
    assert.equal(await responsiveForTest(f.record, 30, { registryDir: f.registryDir, alive: async () => true, wake: async () => outcome }), false);
    // The verdict callers act on (mail holds, lead recovery, role status) is leadState's.
    const state = await leadState({ consumer: f.consumer, env: f.env, home: f.home, ackTimeoutMs: 0, probes: { alive: async () => true } });
    assert.equal(state.status, expected, JSON.stringify(outcome));
    if (expected === 'unproven') assert.equal(state.verdict_source, 'undelivered');
  }
});

test('the probe interval backs off while the lead keeps answering, and resets when it does not', async (t) => {
  const base = responsiveTtlMs(1);
  assert.deepEqual([responsiveTtlMs(2), responsiveTtlMs(3), responsiveTtlMs(9)], [base * 2, base * 4, base * 4], 'doubles per answer, capped');
  const f = await fixture(t);
  let rings = 0;
  const answering = { registryDir: f.registryDir, alive: async () => true, wake: async (_record, nonce) => {
    rings += 1;
    await writeJson(join(f.dir, `${nonce}.ack.json`), await readJson(join(f.dir, `${nonce}.json`)));
    return { rang: true, submitted: true };
  } };
  const memoPath = join(f.dir, 'lead0001.answered.json');
  const age = async (ms) => writeJson(memoPath, { ...await readJson(memoPath), at: Date.now() - ms });
  assert.equal(await responsiveForTest(f.record, 200, answering), true);
  assert.equal((await readJson(memoPath)).streak, 1);
  await age(base + 1000);
  assert.equal(await responsiveForTest(f.record, 200, answering), true);
  assert.deepEqual([rings, (await readJson(memoPath)).streak], [2, 2], 'a first-answer proof past its lifetime is probed again');
  await age(base + 1000);
  assert.equal(await responsiveForTest(f.record, 200, answering), true);
  assert.equal(rings, 2, 'after two answers the same age is still proof: no ring, no model turn spent');
  await age(base * 2 + 1000);
  assert.equal(await responsiveForTest(f.record, 30, { ...answering, wake: async () => { rings += 1; return { rang: true, submitted: true }; } }), false);
  await rm(join(f.registryDir, 'probe-state', 'lead0001.last-probe.json'));
  assert.equal(await responsiveForTest(f.record, 200, answering), true);
  assert.equal((await readJson(memoPath)).streak, 1, 'a delivered, unanswered probe ends the run');
});

test('the lead ring addresses the binding\'s tmux server (TM-402), for the probe and the held-mail ring alike', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-tm402-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = join(root, 'argv.log'), shim = join(root, 'tmux-shim');
  await writeFile(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`);
  await chmod(shim, 0o755);
  const lead = { agent_id: 'lead0001', pane: BINDING.paneId, provider: 'claude', consumer: root, binding: { ...BINDING } };
  const result = await ringLeadPane(lead, 'AO_PROBE x', {
    loadAdapters: async () => new Map([['claude', ADAPTER]]),
    // Inside the helper every tmux call is scoped by withServer; this records the argv it produced.
    wake: async ({ pane }) => { await tmux.tmux(['display-message', '-p', '-t', pane, 'x'], { env: { AO_TMUX_COMMAND: shim }, allowFailure: true }); return { rang: true }; },
  });
  assert.equal(result.rang, true);
  const argv = (await readFile(log, 'utf8')).trim();
  assert.equal(argv, `-S ${BINDING.serverKey} display-message -p -t ${BINDING.paneId} x`, 'the ring went to the recorded server, not the default one');
  const unbound = await ringLeadPane({ ...lead, binding: null }, 'x', { wake: async () => assert.fail('never rung without an incarnation') });
  assert.equal(unbound.rang, false);
});
