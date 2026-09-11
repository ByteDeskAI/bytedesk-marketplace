// TM-167 contract: first contact from many places at once. Concurrent session starts in one enrolled
// repository's main checkout and its linked worktrees must converge on ONE repository supervisor, and
// that supervisor must give the repository ONE managed lead. Criterion 2 needs both halves of TM-167:
// enrollment-gated activation starts the supervisor, and receiver-owned recovery creates the lead.
//
// Nothing here calls activation or recovery directly. The actors are `startup-check --source hook`, as
// a provider's session-start hook runs it, and the supervisor those calls start. The test stands in
// for the lead in one place only: answering its nonce probe with `lead ack`, as a lead would.
//
// Isolation (.claude/rules/tmux-test-isolation.md): TMUX is blanked, TMUX_TMPDIR is per test, every
// tmux call that could reach a server uses a socket asserted to live under this test's TMUX_TMPDIR,
// and supervisors are reaped before the server is killed and the directory removed.
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
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { readJson, sleep, writeJson } from '../../topology/lib/util.mjs';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(root, 'topology', 'cli.mjs');
const fixtures = join(root, 'tests', 'fixtures');
const hasTmux = await execFile('tmux', ['-V']).then(() => true, () => false);

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

/** Every supervisor whose consumer is `dir` or anything under it. */
async function supervisorsUnder(dir) {
  const { stdout } = await execFile('pgrep', ['-f', `supervise --consumer ${dir}(/| |$)`]).catch((error) => ({ stdout: error.stdout ?? '' }));
  return stdout.split('\n').filter(Boolean).map(Number);
}

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

async function sessionsOn(env, socket) {
  const { stdout } = await execFile('tmux', ['-S', ownSocket(env, socket), 'list-sessions', '-F', '#{session_name}'], { env });
  return stdout.split('\n').filter(Boolean).sort();
}

/** Answer every lead nonce probe through the real `lead ack` verb, as the lead would from its shell. */
function answerProbes(env, consumer, signal) {
  const dir = join(env.AGENT_ORCHESTRATION_STATE_HOME, 'leads', 'probes');
  const answered = new Set();
  return (async () => {
    while (!signal.aborted) {
      for (const name of await readdir(dir).catch(() => [])) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        const probe = await readJson(join(dir, name)).catch(() => null);
        if (!probe?.nonce || !probe.agent_id || answered.has(probe.nonce)) continue;
        answered.add(probe.nonce);
        await execFile(process.execPath, [cli, 'lead', 'ack', probe.nonce, '--consumer', consumer], { env: { ...env, AO_AGENT_ID: probe.agent_id } }).catch(() => {});
      }
      await sleep(100);
    }
  })();
}

test('concurrent session starts across linked worktrees converge on one supervisor and one managed lead', { skip: !hasTmux, timeout: 300_000 }, async (t) => {
  const base = await mkdtemp(join(os.tmpdir(), 'ao-lead-convergence-'));
  const tmuxDir = join(base, 'tmux');
  await mkdir(tmuxDir, { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_PANE: '', TMUX_TMPDIR: tmuxDir,
    AGENT_ORCHESTRATION_STATE_HOME: join(base, 'state'), XDG_CONFIG_HOME: join(base, 'config'),
    AO_RECONCILE_MIN_MS: '0', AO_LEAD_ACK_TIMEOUT_MS: '4000' };
  for (const key of ['AO_LEAD_ID', 'AO_AGENT_ID', 'AO_CONSUMER', 'AO_SESSION']) delete env[key];
  const stop = new AbortController();
  let acking = Promise.resolve();
  // One hook, in order: stop answering, reap supervisors, kill our own server, then remove.
  t.after(async () => {
    stop.abort();
    await acking;
    const survivors = await stopSupervisors(base);
    await killIsolatedServer(env);
    assert.deepEqual(survivors, [], `supervisors outlived teardown; ${base} kept for inspection`);
    await rm(base, { recursive: true, force: true });
  });

  // One enrolled repository with a fake-provider lead template, plus three linked worktrees.
  const repo = join(base, 'repo');
  await execFile('git', ['init', '-q', repo]);
  await execFile('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const home = join(repo, '.bytedesk', 'agent-orchestration');
  await mkdir(join(home, 'providers'), { recursive: true });
  await copyFile(join(fixtures, 'fake-agent.json'), join(home, 'providers', 'fake-agent.json'));
  await writeFile(join(home, 'fake-lead.md'), 'You are a test lead. Answer nonce probes with ao-topology lead ack.\n');
  await writeJson(join(home, 'config.json'), { enabled: true, lead: { template: 'fake-lead' },
    templates: { 'fake-lead': { role: 'lead', cli: 'fake-agent', model: 'fake', prompt: './fake-lead.md', args: [join(fixtures, 'fake-agent.mjs')] } } });
  const worktrees = [];
  for (const name of ['wt1', 'wt2', 'wt3']) {
    const path = join(base, name);
    await execFile('git', ['-C', repo, 'worktree', 'add', '-q', path, '-b', name]);
    worktrees.push(path);
  }
  const key = repoKey((await canonicalRepoId(repo)).id);
  for (const path of worktrees) assert.equal(repoKey((await canonicalRepoId(path)).id), key, `${path} must share the repository identity`);

  acking = answerProbes(env, repo, stop.signal);

  // First contact: five session starts at once, from the main checkout and every worktree (one twice).
  const starts = [repo, ...worktrees, worktrees[0]];
  const results = await Promise.all(starts.map((consumer) => execFile(process.execPath, [cli, 'startup-check', '--source', 'hook', '--consumer', consumer], { env, encoding: 'utf8', timeout: 120_000 })
    .then((result) => ({ consumer, code: 0, stdout: result.stdout }), (error) => ({ consumer, code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }))));
  for (const result of results) {
    // Exit 2 means "readiness blocked", which is expected before any lead exists.
    assert.ok([0, 2].includes(result.code), `startup-check failed: ${JSON.stringify(result)}`);
    const activation = JSON.parse(result.stdout).activation;
    assert.equal(activation?.enrollment?.enrolled, true, `session start in ${result.consumer} must activate the enrolled repository: ${JSON.stringify(activation)}`);
  }

  // One supervisor, whichever start won.
  await waitFor('a repository supervisor', async () => { const pids = await supervisorsUnder(base); return { ok: pids.length >= 1, value: pids }; }, 30_000);

  // The supervisor, not any start, creates the lead and proves it answers.
  const recovered = await waitFor('the supervisor to create and verify one lead', async () => {
    const status = await leadRecoveryStatus({ consumer: repo, env });
    return { ok: status.action === 'reused', value: status };
  }, 240_000);
  assert.deepEqual([recovered.attempts, recovered.last_error, recovered.next_retry_at], [0, null, null]);

  const registration = join(leadRegistryDir(env), `${key}.json`);
  const lead = await readJson(registration);
  assert.equal(lead.managed, true, 'a created lead is managed');
  assert.ok(lead.binding?.serverKey, 'the lead records its exact incarnation');
  const socket = ownSocket(env, lead.binding.serverKey);

  const supervisors = await supervisorsUnder(base);
  assert.equal(supervisors.length, 1, `exactly one supervisor across ${starts.length} concurrent starts: ${supervisors.join(', ')}`);
  assert.deepEqual(await sessionsOn(env, socket), [lead.session], 'exactly one session on the server, and it is the lead');
  assert.deepEqual((await readdir(leadRegistryDir(env))).filter((name) => /\.json$/.test(name)), [`${key}.json`], 'one lead registration, keyed by the shared identity');

  // Later reconciles and later session starts change nothing.
  await Promise.all(worktrees.map((consumer) => execFile(process.execPath, [cli, 'startup-check', '--source', 'hook', '--consumer', consumer], { env, timeout: 120_000 }).catch(() => {})));
  await sleep(8_000);
  assert.deepEqual(await supervisorsUnder(base), supervisors, 'the same single supervisor');
  assert.deepEqual(await sessionsOn(env, socket), [lead.session], 'still exactly one lead session');
  assert.deepEqual((await readJson(registration)).binding, lead.binding, 'the lead was neither restarted nor replaced');
});
