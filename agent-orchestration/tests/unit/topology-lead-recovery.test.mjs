// TM-167: receiver-owned lead recovery. Every tmux touch and the clock are injected, so each branch of
// the policy is exercised with no tmux server and no provider — and every "never" below is a probe
// that fails the test if it is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLead, leadRegistryDir } from '../../topology/lib/lead.mjs';
import { leadRecoveryStatus, recoverLead, requestLeadRecovery, retryDelayMs } from '../../topology/lib/lead-recovery.mjs';
import { lockHeld } from '../../topology/lib/lockfile.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { readJson, run, writeJson } from '../../topology/lib/util.mjs';

const pluginRoot = fileURLToPath(new URL('../..', import.meta.url));
const T0 = Date.parse('2026-09-11T12:00:00.000Z');
const BINDING = { serverKey: '/nonexistent/ao-recovery-test', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 100 };
const OUTAGE = () => Object.assign(new Error('Cannot enumerate tmux panes; liveness is unknown.'), { code: 'TOPOLOGY_TMUX_OBSERVATION_FAILED' });

async function world(t, { enrolled = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ao-lead-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  const env = { XDG_CONFIG_HOME: join(home, '.config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const identity = await canonicalRepoId(repo);
  const registry = leadRegistryDir(env, home), key = repoKey(identity.id);
  const w = {
    clock: T0, enrolled, alive: [], aliveDefault: true, responsive: true, opens: 0, openError: null, probeTimeouts: [],
    recordPath: join(registry, `${key}.json`), lockPath: join(registry, `${key}.lock`),
    statePath: join(registry, `${key}.recovery.json`), journalPath: join(registry, `${key}.recovery.jsonl`),
  };
  const probes = {
    // A queue of answers, then the default; an Error in the queue is thrown, the way tmux.mjs does.
    alive: async () => { const next = w.alive.length ? w.alive.shift() : w.aliveDefault; if (next instanceof Error) throw next; return next; },
    responsive: async (_record, ackTimeoutMs) => { w.probeTimeouts.push(ackTimeoutMs); return w.responsive; },
    pane: async () => '%1',
    open: async () => {
      if (w.openError) throw w.openError;
      w.opens += 1;
      return { session: 'ao-lead', pane: '%1', binding: { ...BINDING, panePid: 100 + w.opens } };
    },
    kill: async () => assert.fail('lead recovery must never kill a lead'),
  };
  w.opts = { consumer: repo, env, home, pluginRoot, probes, now: () => w.clock,
    enrollment: async () => ({ enrolled: w.enrolled, source: w.enrolled ? 'repo-config' : 'none', repo_id: identity.id, root: repo }) };
  w.recover = (extra = {}) => recoverLead({ ...w.opts, ...extra });
  w.at = (ms) => new Date(w.clock + ms).toISOString();
  w.request = (messageId = 'msg-1') => requestLeadRecovery({ consumer: repo, env, home, reason: 'leads_not_ready', messageId });
  return w;
}

test('retry delay is 10s, 30s, 2m, then capped at 10m', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(retryDelayMs), [10_000, 10_000, 30_000, 120_000, 600_000, 600_000, 600_000]);
});

test('an unenrolled repository is never observed or given a lead; an enrolled one with none gets one created', async t => {
  const w = await world(t, { enrolled: false });
  w.aliveDefault = new Error('an unenrolled repository must not even be observed');
  await w.request();
  const refused = await w.recover();
  assert.equal(refused.action, 'not-enrolled');
  assert.equal(w.opens, 0);
  assert.deepEqual(w.probeTimeouts, []);
  await assert.rejects(readFile(w.recordPath), { code: 'ENOENT' }, 'no lead registration is written');
  await assert.rejects(readFile(w.statePath), { code: 'ENOENT' }, 'no recovery state is written');

  w.enrolled = true;
  const created = await w.recover();
  assert.equal(created.action, 'created');
  assert.equal(w.opens, 1);
  assert.equal(created.attempts, 1, 'a launch counts as an attempt until the lead proves it answers');
  assert.equal(created.verify, true);
  assert.equal(created.next_retry_at, w.at(10_000));
  assert.equal((await readJson(w.recordPath)).managed, true);
});

test('a responsive lead is reused, and is rung only when someone asked for proof', async t => {
  const w = await world(t);
  await ensureLead(w.opts);
  const quiet = await w.recover();
  assert.equal(quiet.action, 'reused');
  assert.deepEqual(w.probeTimeouts, [0], 'with no request, recovery reads cached proof only');

  await w.request();
  const asked = await w.recover();
  assert.equal(asked.action, 'reused');
  assert.ok(w.probeTimeouts[1] > 0, 'a pending request is what licenses an active probe');
  assert.equal((await leadRecoveryStatus(w.opts)).pending_requests, 0, 'a proven lead consumes the requests');
  assert.equal(w.opens, 1, 'reuse opens nothing');
});

test('a live unresponsive lead is never restarted, killed or duplicated, and its probe backs off', async t => {
  const w = await world(t);
  await ensureLead(w.opts);
  const before = await readJson(w.recordPath);
  w.responsive = false;

  const idle = await w.recover();
  assert.equal(idle.action, 'kept-unresponsive');
  assert.equal(idle.attempts, 0, 'alive and nobody asked: not a failure');

  await w.request();
  const first = await w.recover();
  assert.equal(first.action, 'kept-unresponsive');
  assert.equal(first.attempts, 1);
  assert.match(first.last_error, /^TOPOLOGY_LEAD_UNRESPONSIVE/);
  assert.equal(first.next_retry_at, w.at(10_000));

  w.clock += 9_999;
  assert.equal((await w.recover()).action, 'backoff');
  assert.equal(w.probeTimeouts.filter(ms => ms > 0).length, 1, 'no second ring inside the window');
  w.clock += 1;
  const second = await w.recover();
  assert.equal(second.attempts, 2);
  assert.equal(second.next_retry_at, w.at(30_000));

  assert.equal(w.opens, 1, 'never a second session');
  assert.deepEqual(await readJson(w.recordPath), before, 'the registration and its live incarnation are untouched');
});

test('a dead managed lead restarts only after its recorded incarnation is re-verified gone', async t => {
  const w = await world(t);
  const { record } = await ensureLead(w.opts);

  // The first look says dead; the re-observation under the registration lock says alive. Nothing opens.
  w.alive = [false, true];
  w.responsive = false;
  const flicker = await w.recover();
  assert.equal(flicker.action, 'kept-unresponsive');
  assert.equal(flicker.reverified_alive, true);
  assert.equal(w.opens, 1);

  // A tmux observation failure is not death: neither on the first look...
  w.alive = [OUTAGE()];
  const unknown = await w.recover();
  assert.equal(unknown.action, 'failed');
  assert.match(unknown.last_error, /^TOPOLOGY_TMUX_OBSERVATION_FAILED/);
  assert.equal(w.opens, 1);
  // ...nor on the re-observation.
  w.clock += 10_000;
  w.alive = [false, OUTAGE()];
  const unknownInLock = await w.recover();
  assert.equal(unknownInLock.action, 'failed');
  assert.equal(unknownInLock.attempts, 2);
  assert.equal(w.opens, 1);

  // Gone on both looks: restarted under the same identity. AO_LEAD_ID inherited from a lead's own
  // session must not make the supervisor believe it IS the lead.
  w.clock += 30_000;
  w.aliveDefault = false;
  const restarted = await w.recover({ env: { ...w.opts.env, AO_LEAD_ID: record.agent_id, AO_CONSUMER: w.opts.consumer } });
  assert.equal(restarted.action, 'restarted');
  assert.equal(restarted.attempts, 3);
  assert.equal(w.opens, 2);
  assert.equal((await readJson(w.recordPath)).agent_id, record.agent_id);

  // A record with no exact binding cannot prove absence: no unattended restart.
  await writeJson(w.recordPath, { ...(await readJson(w.recordPath)), binding: null });
  w.clock += 120_000;
  const unbound = await w.recover();
  assert.equal(unbound.action, 'failed');
  assert.match(unbound.last_error, /^TOPOLOGY_LEAD_OWNERSHIP_UNKNOWN/);
  assert.equal(w.opens, 2);
});

test('a dead externally owned lead is held with a reassignment alert, journalled once, never replaced', async t => {
  const w = await world(t);
  const { record } = await ensureLead(w.opts);
  await writeJson(w.recordPath, { ...record, mode: 'assigned', managed: false, externally_owned: true, session: 'human-session' });
  w.aliveDefault = false;
  await w.request();

  const held = await w.recover();
  assert.equal(held.action, 'held-dead-external');
  assert.equal(held.alert.code, 'TOPOLOGY_LEAD_DEAD_EXTERNAL');
  assert.equal(held.alert.command, `ao-topology lead assign ${record.agent_id} --session human-session --consumer ${w.opts.consumer}`);
  assert.equal(held.last_error, held.alert.message);
  assert.equal(held.next_retry_at, w.at(10_000));
  for (const step of [10_000, 30_000, 120_000]) {
    w.clock += step;
    assert.equal((await w.recover()).action, 'held-dead-external');
  }
  assert.equal(w.opens, 1, 'nothing is started in its place');
  const journal = (await readFile(w.journalPath, 'utf8')).trim().split('\n');
  assert.equal(journal.length, 1, 'the alert is journalled once, not every tick');
  assert.equal(JSON.parse(journal[0]).event, 'lead.dead_external');
  assert.equal((await leadRecoveryStatus(w.opts)).alert.command, held.alert.command);
});

test('a provider failure backs off 10s, 30s, 2m, 10m, 10m visibly, and resets once the lead is responsive', async t => {
  const w = await world(t);
  w.openError = Object.assign(new Error('Provider is not accepting its startup instructions.'), { code: 'TOPOLOGY_SESSION_START' });
  const seen = [];
  for (const expected of [10_000, 30_000, 120_000, 600_000, 600_000]) {
    const failed = await w.recover();
    assert.equal(failed.action, 'failed');
    assert.equal(failed.last_error, 'TOPOLOGY_SESSION_START: Provider is not accepting its startup instructions.');
    seen.push([failed.attempts, Date.parse(failed.next_retry_at) - w.clock]);
    w.clock += expected - 1;
    assert.equal((await w.recover()).action, 'backoff', 'one millisecond early is still inside the window');
    w.clock += 1;
  }
  assert.deepEqual(seen, [[1, 10_000], [2, 30_000], [3, 120_000], [4, 600_000], [5, 600_000]]);
  const status = await leadRecoveryStatus(w.opts);
  assert.deepEqual([status.action, status.attempts, status.next_retry_at], ['failed', 5, new Date(w.clock).toISOString()]);
  assert.equal(w.opens, 0);

  w.openError = null;
  const created = await w.recover();
  assert.equal(created.action, 'created');
  assert.equal(created.attempts, 6);
  assert.equal(created.last_error, null);
  w.clock += 600_000;
  const proven = await w.recover();
  assert.equal(proven.action, 'reused');
  assert.deepEqual([proven.attempts, proven.last_error, proven.next_retry_at], [0, null, null]);
  assert.ok(w.probeTimeouts.at(-1) > 0, 'verifying a launched lead is an active probe');
});

test('a recovery request is a durable marker, not a recovery in the caller', async t => {
  const w = await world(t);
  assert.equal((await w.request()).requested, true);
  await w.request();
  assert.equal((await leadRecoveryStatus(w.opts)).pending_requests, 1, 'the same message and reason is one request');
  assert.equal(w.opens, 0);
  await assert.rejects(readFile(w.recordPath), { code: 'ENOENT' });
});

test('ensureLead probes a live lead with the registration lock released', async t => {
  const w = await world(t);
  await ensureLead(w.opts);
  let heldDuringProbe = null;
  const probes = { ...w.opts.probes, alive: async () => true, responsive: async () => { heldDuringProbe = await lockHeld(w.lockPath); return true; } };
  assert.equal((await ensureLead({ ...w.opts, probes })).action, 'reused');
  assert.equal(heldDuringProbe, false, 'a probe that can wait a model turn must not hold the lock other ensures queue on');
});

test('a supervisor tick is quiet for an unenrolled repository and reports recovery for an enrolled one', async t => {
  const { mkdir, readdir } = await import('node:fs/promises');
  const { superviseRepository } = await import('../../topology/lib/supervision.mjs');
  const root = await mkdtemp(join(tmpdir(), 'ao-recovery-tick-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = { unenrolled: join(root, 'unenrolled'), enrolled: join(root, 'enrolled') };
  const home = join(root, 'home'), tmuxDir = join(root, 'tmux');
  await mkdir(tmuxDir, { recursive: true });
  // tmux isolation: no inherited server, a per-test TMUX_TMPDIR, and every listing names a server.
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: tmuxDir, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(home, '.config') };
  for (const key of ['AO_LEAD_ID', 'AO_AGENT_ID', 'AO_CONSUMER']) delete env[key];
  for (const repo of Object.values(repos)) await run('git', ['init', '-q', repo]);
  // Enrolled through an existing lead registration. Its recorded incarnation names a socket that does
  // not exist, and its library agent is gone, so recovery observes it dead and fails before anything
  // could open.
  const identity = await canonicalRepoId(repos.enrolled);
  const registry = leadRegistryDir(env, home), registration = `${repoKey(identity.id)}.json`;
  await writeJson(join(registry, registration), { version: 1, repo_id: identity.id, agent_id: 'gone0001', mode: 'dedicated', managed: true, externally_owned: false,
    session: 'ao-gone0001', pane: '%9', binding: { ...BINDING, serverKey: join(tmuxDir, 'no-such-socket') }, consumer: repos.enrolled });
  const tick = (consumer) => superviseRepository({ consumer, home, env, pluginRoot, tmuxServer: `ao-absent-${process.pid}` }, { once: true });

  const quiet = await tick(repos.unenrolled);
  assert.equal(Object.hasOwn(quiet, 'lead_recovery'), false, 'an unenrolled repository adds no report key');
  assert.deepEqual(await readdir(registry), [registration], 'and writes no recovery state, lock or journal');

  const loud = await tick(repos.enrolled);
  assert.equal(loud.lead_recovery?.action, 'failed', JSON.stringify(loud.lead_recovery));
  assert.match(loud.lead_recovery.last_error, /^TOPOLOGY_LEAD_AGENT_MISSING/);
  assert.equal(loud.lead_recovery.attempts, 1);
});
