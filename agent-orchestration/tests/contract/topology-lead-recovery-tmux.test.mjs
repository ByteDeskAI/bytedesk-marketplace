// TM-167 contract: receiver-owned lead recovery on a real tmux server, with fake agents.
//
// Two repositories, each with a managed lead launched by `lead ensure` from a fake provider, and each
// with the repository supervisor that `lead ensure` starts. Nothing in this file calls recovery
// itself: the only actors are the CLI a sender would run and the supervisors. The test stands in for
// the agents in exactly one place — answering a lead's nonce probe with `lead ack`, as a lead would —
// and only in the test that needs responsive leads.
//
// Isolation (.claude/rules/tmux-test-isolation.md): TMUX is blanked, TMUX_TMPDIR is per test, and the
// one kill-session and the teardown kill-server are scoped by a socket asserted to live under this
// test's TMUX_TMPDIR. Supervisors are stopped before the server is killed, and both before removal.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { leadRecoveryStatus } from '../../topology/lib/lead-recovery.mjs';
import { leadRegistryDir } from '../../topology/lib/lead.mjs';
import { readStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { readJson, sleep, writeJson } from '../../topology/lib/util.mjs';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(root, 'topology', 'cli.mjs');
const fixtures = join(root, 'tests', 'fixtures');
const hasTmux = await execFile('tmux', ['-V']).then(() => true, () => false);
const TUPLE = ['socket_path', 'pid', 'session_id', 'session_created', 'pane_id', 'pane_pid', 'pane_dead'];

async function ao(args, env) {
  const { stdout } = await execFile(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 120_000 });
  return JSON.parse(stdout);
}

async function waitFor(what, probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last?.ok) return last.value;
    await sleep(500);
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for ${what}; last observation: ${JSON.stringify(last?.value ?? last)}`);
}

async function supervisorsFor(consumer) {
  const { stdout } = await execFile('pgrep', ['-f', `supervise --consumer ${consumer}( |$)`]).catch((error) => ({ stdout: error.stdout ?? '' }));
  return stdout.split('\n').filter(Boolean).map(Number);
}

/** Every supervisor whose consumer is `dir` or anything under it. */
async function supervisorsUnder(dir) {
  const { stdout } = await execFile('pgrep', ['-f', `supervise --consumer ${dir}(/| |$)`]).catch((error) => ({ stdout: error.stdout ?? '' }));
  return stdout.split('\n').filter(Boolean).map(Number);
}

/**
 * Stop every supervisor under `dir` and return the pids that survived. Several rounds, because one
 * pass reaps only what was running when it listed: a supervisor another repository's activation was
 * starting at that moment would otherwise outlive the test and tick against a deleted directory.
 */
async function stopSupervisors(dir) {
  for (let round = 0; round < 3; round += 1) {
    const pids = await supervisorsUnder(dir);
    if (!pids.length) break;
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    for (let i = 0; i < 50 && (await supervisorsUnder(dir)).length; i += 1) await sleep(100);
    for (const pid of await supervisorsUnder(dir)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await sleep(200);
  }
  return supervisorsUnder(dir);
}

function ownSocket(env, socket) {
  assert.ok(env.TMUX === '' && socket.startsWith(`${env.TMUX_TMPDIR}/`), `refusing to touch a tmux server outside this test's TMUX_TMPDIR: ${socket}`);
  return socket;
}

async function killIsolatedServer(env) {
  const socket = await execFile('tmux', ['list-panes', '-a', '-F', '#{socket_path}'], { env })
    .then((result) => result.stdout.split('\n')[0].trim()).catch(() => '');
  if (socket) await execFile('tmux', ['-S', ownSocket(env, socket), 'kill-server'], { env }).catch(() => {});
}

async function panes(env, socket) {
  const { stdout } = await execFile('tmux', ['-S', ownSocket(env, socket), 'list-panes', '-a', '-F', TUPLE.map((key) => `#{${key}}`).join('|')], { env });
  return stdout.split('\n').filter(Boolean).map((line) => Object.fromEntries(line.split('|').map((value, i) => [TUPLE[i], value])));
}

async function world(t, { enrolled = ['source', 'destination'] } = {}) {
  const base = await mkdtemp(join(os.tmpdir(), 'ao-lead-recovery-'));
  const tmuxDir = join(base, 'tmux');
  await mkdir(tmuxDir, { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_PANE: '', TMUX_TMPDIR: tmuxDir,
    AGENT_ORCHESTRATION_STATE_HOME: join(base, 'state'), XDG_CONFIG_HOME: join(base, 'config'),
    // Reconcile on every tick, and give a probe four seconds rather than a model turn's thirty.
    AO_RECONCILE_MIN_MS: '0', AO_LEAD_ACK_TIMEOUT_MS: '4000' };
  for (const key of ['AO_LEAD_ID', 'AO_AGENT_ID', 'AO_CONSUMER', 'AO_SESSION']) delete env[key];
  const repos = {};
  // One hook, in order: reap the supervisors, kill our own server, then remove the directory.
  t.after(async () => {
    const survivors = await stopSupervisors(base);
    await killIsolatedServer(env);
    // A supervisor that outlives its test ticks forever against a deleted directory, so a leak fails
    // the test, and the directory is kept for inspection instead of being removed from under it.
    assert.deepEqual(survivors, [], `supervisors outlived teardown; ${base} kept for inspection`);
    await rm(base, { recursive: true, force: true });
  });
  for (const name of ['source', 'destination']) {
    const repo = join(base, name);
    await execFile('git', ['init', '-q', repo]);
    await execFile('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);
    repos[name] = repo;
    if (!enrolled.includes(name)) continue;
    const home = join(repo, '.bytedesk', 'agent-orchestration');
    await mkdir(join(home, 'providers'), { recursive: true });
    await copyFile(join(fixtures, 'fake-agent.json'), join(home, 'providers', 'fake-agent.json'));
    // A template must name a prompt; relative paths resolve beside this config file.
    await writeFile(join(home, 'fake-lead.md'), 'You are a test lead. Answer nonce probes with ao-topology lead ack.\n');
    // Enrolled explicitly, not merely by the lead registration `lead ensure` writes below, so the
    // fixture means the same thing under every enrollment source.
    await writeJson(join(home, 'config.json'), { enabled: true, lead: { template: 'fake-lead' },
      templates: { 'fake-lead': { role: 'lead', cli: 'fake-agent', model: 'fake', prompt: './fake-lead.md', args: [join(fixtures, 'fake-agent.mjs')] } } });
  }
  const leads = {};
  for (const name of enrolled) {
    const ensured = await ao(['lead', 'ensure', '--consumer', repos[name]], env);
    assert.equal(ensured.action, 'created', JSON.stringify(ensured));
    assert.ok(ensured.record.binding, 'a launched lead records its exact pane incarnation');
    leads[name] = ensured.record;
  }
  const recordPath = async (repo) => join(leadRegistryDir(env), `${repoKey((await canonicalRepoId(repo)).id)}.json`);
  return { env, repos, leads, recordPath };
}

test('held mail to an unenrolled destination never starts a lead or a supervisor there', { skip: !hasTmux, timeout: 240_000 }, async (t) => {
  const { env, repos, leads, recordPath } = await world(t, { enrolled: ['source'] });
  const sent = await ao(['mailbox', 'send', '--consumer', repos.destination, '--from-project', repos.source,
    '--from', leads.source.agent_id, '--to', 'anyone', '--id', 'tm167-unenrolled', '--body', 'PING an unenrolled repository'], env);
  assert.deepEqual([sent.status, sent.reason, sent.recovery], ['held', 'destination_not_enrolled', undefined]);
  // Several reconciles of the enrolled source's supervisor, which must not reach across either.
  await sleep(6_000);
  await assert.rejects(readJson(await recordPath(repos.destination)), { code: 'ENOENT' }, 'no lead registration for the unenrolled destination');
  assert.deepEqual(await supervisorsFor(repos.destination), [], 'no supervisor was started for it');
  const recovery = await leadRecoveryStatus({ consumer: repos.destination, env });
  assert.deepEqual([recovery.action, recovery.pending_requests], [null, 0], 'no recovery state and no recovery request');
  const { stdout } = await execFile('tmux', ['-S', ownSocket(env, leads.source.binding.serverKey), 'list-sessions', '-F', '#{session_name}'], { env });
  assert.deepEqual(stdout.split('\n').filter(Boolean), [leads.source.session], 'the only session on the server is the enrolled source lead');
  assert.equal((await readStandingMessage({ id: 'tm167-unenrolled', env })).reason, 'destination_not_enrolled');
});

/** Answer lead nonce probes through the real `lead ack` verb, as each lead would from its own shell. */
function answerProbes(env, repoByAgent, signal) {
  const dir = join(env.AGENT_ORCHESTRATION_STATE_HOME, 'leads', 'probes');
  const answered = new Set();
  return (async () => {
    while (!signal.aborted) {
      for (const name of await readdir(dir).catch(() => [])) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        const probe = await readJson(join(dir, name)).catch(() => null);
        if (!probe?.nonce || answered.has(probe.nonce) || !repoByAgent[probe.agent_id]) continue;
        answered.add(probe.nonce);
        await ao(['lead', 'ack', probe.nonce, '--consumer', repoByAgent[probe.agent_id]], { ...env, AO_AGENT_ID: probe.agent_id }).catch(() => {});
      }
      await sleep(100);
    }
  })();
}

test('a dead managed lead is restarted by its own supervisor, then held cross-repository mail is delivered once', { skip: !hasTmux, timeout: 240_000 }, async (t) => {
  const { env, repos, leads, recordPath } = await world(t);
  const dead = leads.destination;
  const socket = ownSocket(env, dead.binding.serverKey);
  const stop = new AbortController();
  const acking = answerProbes(env, { [leads.source.agent_id]: repos.source, [dead.agent_id]: repos.destination }, stop.signal);
  try {
    await execFile('tmux', ['-S', socket, 'kill-session', '-t', `=${dead.session}`], { env });
    assert.ok(!(await panes(env, socket)).some((pane) => pane.pane_pid === String(dead.binding.panePid)), 'the destination lead is really gone');

    const sent = await ao(['mailbox', 'send', '--consumer', repos.destination, '--from-project', repos.source,
      '--from', leads.source.agent_id, '--to', dead.agent_id, '--id', 'tm167-dead-managed', '--body', 'PING across repositories'], env);
    assert.equal(sent.status, 'held');
    assert.equal(sent.reason, 'leads_not_ready');
    assert.equal(sent.readiness.destination, 'registered', 'held because the destination lead is dead');
    assert.equal(sent.recovery.destination.requested, true);
    assert.deepEqual((await readJson(await recordPath(repos.destination))).binding, dead.binding, 'the sending process recovers nothing itself');

    const delivered = await waitFor('the held message to be delivered', async () => {
      const message = await readStandingMessage({ id: 'tm167-dead-managed', env });
      return { ok: message?.status === 'delivered', value: message && { status: message.status, reason: message.reason, attempts: message.attempts } };
    }, 180_000);
    assert.ok(delivered);

    const restarted = await readJson(await recordPath(repos.destination));
    assert.equal(restarted.agent_id, dead.agent_id, 'restarted under the same identity');
    assert.notDeepEqual(restarted.binding, dead.binding, 'a new incarnation was opened');
    const live = await panes(env, socket);
    assert.ok(live.some((pane) => pane.pane_pid === String(restarted.binding.panePid) && pane.pane_dead === '0'), 'the recorded incarnation is alive');
    const { stdout } = await execFile('tmux', ['-S', socket, 'list-sessions', '-F', '#{session_name}'], { env });
    assert.equal(stdout.split('\n').filter((name) => name === dead.session).length, 1, 'exactly one destination lead session');

    const recovery = await leadRecoveryStatus({ consumer: repos.destination, env });
    assert.deepEqual([recovery.action, recovery.attempts, recovery.last_error, recovery.next_retry_at], ['reused', 0, null, null], 'backoff resets once the lead answers');

    // Exactly once: more reconciles change nothing.
    const inbox = () => ao(['mailbox', 'inbox', '--consumer', repos.destination, '--agent', dead.agent_id], env);
    assert.equal((await inbox()).length, 1);
    const settled = await readStandingMessage({ id: 'tm167-dead-managed', env });
    await sleep(5_000);
    assert.equal((await inbox()).length, 1, 'still one delivery after further reconciles');
    assert.deepEqual(await readStandingMessage({ id: 'tm167-dead-managed', env }), settled);
  } finally {
    stop.abort();
    await acking;
  }
});

test('a live unresponsive lead is left running, unrestarted and unduplicated, while its mail stays held', { skip: !hasTmux, timeout: 240_000 }, async (t) => {
  const { env, repos, leads, recordPath } = await world(t);
  const lead = leads.destination;
  const socket = ownSocket(env, lead.binding.serverKey);
  const before = (await panes(env, socket)).find((pane) => pane.pane_pid === String(lead.binding.panePid));
  assert.ok(before && before.pane_dead === '0', 'the destination lead starts alive');

  // Nobody answers a probe in this test.
  const sent = await ao(['mailbox', 'send', '--consumer', repos.destination, '--from-project', repos.source,
    '--from', leads.source.agent_id, '--to', lead.agent_id, '--id', 'tm167-unresponsive', '--body', 'PING a busy lead'], env);
  assert.equal(sent.reason, 'leads_not_ready');
  assert.equal(sent.readiness.destination, 'unresponsive');

  const status = await waitFor('the destination supervisor to probe and give up', async () => {
    const recovery = await leadRecoveryStatus({ consumer: repos.destination, env });
    return { ok: recovery.action === 'kept-unresponsive' && recovery.attempts >= 1, value: recovery };
  }, 120_000);
  assert.match(status.last_error, /^TOPOLOGY_LEAD_UNRESPONSIVE/);
  assert.ok(Date.parse(status.next_retry_at) > Date.now() - 1_000, 'the next probe is scheduled, not immediate');

  const after = (await panes(env, socket)).find((pane) => pane.pane_pid === String(lead.binding.panePid));
  assert.deepEqual(after, before, 'the same pane incarnation, alive: not restarted and not killed');
  const { stdout } = await execFile('tmux', ['-S', socket, 'list-sessions', '-F', '#{session_name}'], { env });
  assert.equal(stdout.split('\n').filter((name) => name === lead.session).length, 1, 'not duplicated');
  assert.deepEqual((await readJson(await recordPath(repos.destination))).binding, lead.binding, 'the registration is untouched');
  assert.equal((await readStandingMessage({ id: 'tm167-unresponsive', env })).status, 'held');
});
