// TM-532. Lead probes and held mail: no probe while a cached proof stands, every probe names who asked
// and why, a probe is not judged before one poll interval, `lead status` reports the current reason
// and no resolved alert, `mailbox withdraw` takes --id, and a duplicate held-mail delivery disposes.
// No test here touches tmux: wakes are recorders and liveness is injected.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { leadRegistryDir, responsiveForTest } from '../../topology/lib/lead.mjs';
import { clearCheckoutRepair, leadRecoveryStatus, recordCheckoutRepair } from '../../topology/lib/lead-recovery.mjs';
import { repairCheckout } from '../../topology/lib/checkout-repair.mjs';
import { withLock } from '../../topology/lib/lockfile.mjs';
import { listMailboxReceipts, setMailboxDisposition } from '../../topology/lib/mailbox-receipts.mjs';
import { readStandingInbox, sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { readJson, run, sleep, writeJson } from '../../topology/lib/util.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../topology/cli.mjs');
const BINDING = { serverKey: '/isolated/tm532', serverPid: 100, sessionId: '$1', sessionCreated: 200, paneId: '%2', panePid: 300 };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-tm532-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', consumer]);
  const env = { XDG_CONFIG_HOME: join(home, '.config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_AGENT_ID: 'lead0001' };
  const identity = await canonicalRepoId(consumer);
  const registryDir = leadRegistryDir(env, home);
  const record = { repo_id: identity.id, agent_id: 'lead0001', session: 'lead', pane: BINDING.paneId, consumer, provider: 'claude', binding: { ...BINDING } };
  const dir = join(registryDir, 'probes');
  await mkdir(dir, { recursive: true });
  return { root, consumer, home, env, record, registryDir, dir, identity };
}

const memo = (f, at = Date.now()) => writeJson(join(f.dir, `${f.record.agent_id}.answered.json`),
  { at, streak: 1, answered_nonce: 'n-0', agent_id: f.record.agent_id, repo_id: f.record.repo_id, session: f.record.session, binding: { ...BINDING } });
const probeFiles = async (dir) => (await readdir(dir)).filter((name) => name.endsWith('.json') && !name.includes('.ack.') && !name.endsWith('.answered.json'));

test('a fresh cached proof yields no probe and no ring', async (t) => {
  const f = await fixture(t);
  await memo(f);
  const rings = [];
  const proofs = [];
  const ok = await responsiveForTest(f.record, 30, { registryDir: f.registryDir, alive: async () => true, wake: async (_r, nonce) => { rings.push(nonce); return { rang: true, submitted: true }; }, onProof: (p) => proofs.push(p) });
  assert.equal(ok, true);
  assert.deepEqual(rings, [], 'nothing was rung');
  assert.deepEqual(await probeFiles(f.dir), [], 'no probe file was minted');
  assert.equal(proofs[0]?.source, 'cached');
});

test('a proof recorded while a caller queued for the probe lock stops it minting or ringing', async (t) => {
  const f = await fixture(t);
  const rings = [];
  let release, entered;
  const held = new Promise((resolve) => { release = resolve; });
  const inside = new Promise((resolve) => { entered = resolve; });
  // Another waiter holds the probe lock; the caller passes the outer cached check (no memo yet) and
  // queues. The waiter then records the lead's answer and releases.
  const holder = withLock(join(f.dir, `${f.record.agent_id}.probe.lock`), async () => { entered(); await held; });
  await inside;
  const caller = responsiveForTest(f.record, 30, { registryDir: f.registryDir, alive: async () => true, wake: async (_r, nonce) => { rings.push(nonce); return { rang: true, submitted: true }; } });
  await sleep(200);
  await memo(f);
  release();
  await holder;
  assert.equal(await caller, true, 'the proof recorded under the lock answers the queued caller');
  assert.deepEqual(rings, [], 'the queued caller rang nothing');
  assert.deepEqual(await probeFiles(f.dir), [], 'and minted no probe');
});

test('every probe records requested_by and reason, and the ring outcome names them too', async (t) => {
  const f = await fixture(t);
  const wake = async () => ({ rang: true, submitted: true });
  await responsiveForTest(f.record, 30, { registryDir: f.registryDir, alive: async () => true, wake, requestedBy: 'lead recovery, supervisor pid 7', reason: 'held mail asked for proof: leads_not_ready (m-1)' });
  const [name] = await probeFiles(f.dir);
  const probe = await readJson(join(f.dir, name));
  assert.equal(probe.requested_by, 'lead recovery, supervisor pid 7');
  assert.equal(probe.reason, 'held mail asked for proof: leads_not_ready (m-1)');
  const last = await readJson(join(f.registryDir, 'probe-state', `${f.record.agent_id}.last-probe.json`));
  assert.deepEqual([last.requested_by, last.request_reason], [probe.requested_by, probe.reason]);
  // A caller that names nothing is still traceable: pid and command line.
  const g = await fixture(t);
  await responsiveForTest(g.record, 30, { registryDir: g.registryDir, alive: async () => true, wake });
  const [other] = await probeFiles(g.dir);
  const anonymous = await readJson(join(g.dir, other));
  assert.match(anonymous.requested_by, new RegExp(`pid ${process.pid}`));
  assert.equal(anonymous.reason, 'unspecified');
});

test('a probe is not judged unresponsive before the lead has had one poll interval to see it', async (t) => {
  const f = await fixture(t);
  const misses = [];
  const options = { registryDir: f.registryDir, alive: async () => true, wake: async () => ({ rang: true, submitted: true }), onMiss: (m) => misses.push(m) };
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.equal(misses[0].undelivered, true, 'a probe minted moments ago is unproven, not unresponsive');
  assert.match(misses[0].reason, /poll interval/);
  // Once the probe has been pending longer than a poll interval, silence counts.
  const [name] = await probeFiles(f.dir);
  const probe = await readJson(join(f.dir, name));
  await writeJson(join(f.dir, name), { ...probe, created_at: new Date(Date.now() - 10 * 60_000).toISOString() });
  assert.equal(await responsiveForTest(f.record, 30, options), false);
  assert.equal(misses[1].undelivered, false, 'a probe older than one poll interval that went unanswered is evidence');
});

test('lead status: a responsive lead reports no recovery error, and a resolved checkout alert is cleared', async (t) => {
  const f = await fixture(t);
  const key = repoKey(f.identity.id);
  await writeJson(join(f.registryDir, `${key}.recovery.json`), { version: 1, repo_id: f.identity.id, consumer: f.consumer, action: 'kept-unproven', attempts: 33,
    last_error: 'TOPOLOGY_LEAD_UNPROVEN: the lead provider has no measured safe composer', next_retry_at: null });
  const stale = await leadRecoveryStatus({ consumer: f.consumer, env: f.env, home: f.home });
  assert.match(stale.last_error, /no measured safe composer/, 'precondition: the record carries the old error');
  const now = await leadRecoveryStatus({ consumer: f.consumer, env: f.env, home: f.home, current: { status: 'responsive' } });
  assert.equal(now.last_error, null, 'the reason is the current one, not the last pass');
  // A refusal recorded against a checkout that is now healthy is cleared at the next check.
  const real = (await canonicalRepoId(f.consumer)).root ?? f.consumer;
  await recordCheckoutRepair({ consumer: real, env: f.env, home: f.home, entry: { action: 'refused', path: real, status: 'corrupt', attempts: 1,
    alert: { code: 'TOPOLOGY_CHECKOUT_NOT_REPAIRABLE', path: real, message: 'invalid reflog entry' }, at: new Date().toISOString() } });
  assert.ok((await leadRecoveryStatus({ consumer: f.consumer, env: f.env, home: f.home })).checkout_repair, 'precondition: the alert is on record');
  const report = await repairCheckout({ dir: f.consumer, fsck: true, env: f.env, home: f.home, ensureLead: null });
  assert.equal(report.action, 'healthy');
  assert.equal((await leadRecoveryStatus({ consumer: f.consumer, env: f.env, home: f.home })).checkout_repair, undefined, 'the resolved alert is gone');
  assert.equal(await clearCheckoutRepair({ consumer: f.consumer, env: f.env, home: f.home }), false, 'clearing twice is a no-op');
});

test('a duplicate held-mail delivery: dispose before the inbox pull succeeds, and the redelivery is a no-op', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-tm532-mail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), home = join(root, 'home');
  await mkdir(consumer, { recursive: true });
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  for (const [id, role] of [['lead0001', 'lead'], ['work0001', 'worker']]) await writeJson(join(agentsRoot(consumer), id, 'agent.json'), { id, role, full_name: id });
  const transport = { kind: 'file' };
  const opts = { env, home, transport, enrollment: async () => ({ enrolled: true }) };
  const sent = await sendStandingMessage({ id: 'dup-1', consumer, fromProject: consumer, from: 'lead0001', to: 'work0001', body: 'held body' }, opts);
  assert.equal(sent.status, 'delivered');
  const scope = { consumer, agent: 'work0001', messageId: 'dup-1', env, home };
  const handled = await setMailboxDisposition({ ...scope, disposition: 'handled', reason: 'done' });
  assert.equal(handled.status, 'handled', 'dispose finds the delivered message although no inbox pull accepted it yet');
  assert.deepEqual(await readStandingInbox({ consumer, agent: 'work0001', transport, env, home }), [], 'the later delivery dedupes onto the handled receipt');
  const receipts = await listMailboxReceipts({ consumer, agent: 'work0001', env, home });
  assert.deepEqual(receipts.map((r) => [r.messageId, r.status]), [['dup-1', 'handled']]);
  assert.equal((await setMailboxDisposition({ ...scope, disposition: 'handled', reason: 'done' })).status, 'handled', 'disposing again is idempotent');
  await assert.rejects(setMailboxDisposition({ ...scope, messageId: 'never-sent', disposition: 'handled' }), { code: 'TOPOLOGY_MAILBOX_RECEIPT_MISSING' }, 'an unknown id still refuses');
});

test('mailbox withdraw accepts --id like send, and the positional form still works', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ao-tm532-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await run('git', ['init', '-q', consumer]);
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_AGENT_ID: 'send0001', AO_CONSUMER: consumer, AO_TRANSPORT: 'file', TMUX: '' };
  const codeOf = async (args) => {
    const result = await promisify(execFile)(process.execPath, [CLI, 'mailbox', 'withdraw', ...args, '--consumer', consumer], { env, cwd: consumer }).then((r) => r, (e) => e);
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return /(TOPOLOGY_[A-Z_]+)/.exec(text)?.[1] ?? text.slice(0, 300);
  };
  // No such message: the id was read, so the refusal is about the message, not a missing id.
  for (const args of [['--id', 'nope-1'], ['nope-1']]) {
    const code = await codeOf(args);
    assert.notEqual(code, 'TOPOLOGY_MESSAGE_ID_INVALID', `withdraw ${args.join(' ')} read the id`);
    assert.equal(code, 'TOPOLOGY_SENDER_MISMATCH', `withdraw ${args.join(' ')}: ${code}`);
  }
  assert.equal(await codeOf([]), 'TOPOLOGY_MESSAGE_ID_INVALID', 'no id at all still refuses');
});
