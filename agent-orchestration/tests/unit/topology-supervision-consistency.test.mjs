// Two properties that are easy to state and were both wrong, and that nothing else guards.
//
// TM-140 — `lead assign|ensure` and `role assign|ensure lead` are TWO SURFACES ONTO ONE OPERATION,
//   so they must agree about what a supervisor that cannot start means. The test drives both and
//   compares the answers, because the one-line fix is not the deliverable: the comparison is.
// TM-141 — a tmux enumeration failure must degrade one tick, never end superviseRepository. The
//   monitor's restart of a supervisor that merely lost sight of tmux is what makes a flaky tmux
//   read as a crash loop in `doctor`, and `restarts` is the number that identifies a real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { run, readJson, writeJson, sleep } from '../../topology/lib/util.mjs';
import { roleSessionName } from '../../topology/lib/launch.mjs';
import { superviseRepository } from '../../topology/lib/supervision.mjs';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));

// ── TM-141 ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A tmux that fails on demand. `AO_TMUX_COMMAND` is the only seam tmux.mjs offers, and failing the
 * binary is the honest way to reproduce the outage: it takes out the reconcile listing, the census
 * listing and the presence heartbeat's listing at once, which is exactly what a real tmux hiccup
 * does. The stderr deliberately does NOT say "no server running" — that string is a legitimate
 * empty answer, not a failure.
 */
async function flakyTmux(dir) {
  const script = join(dir, 'tmux-stub.sh'), flag = join(dir, 'tmux-broken');
  await writeFile(script, `#!/bin/sh\nif [ -e "${flag}" ]; then echo "tmux: connection refused by stub" >&2; exit 1; fi\nexec tmux "$@"\n`);
  await chmod(script, 0o755);
  await writeFile(flag, '');
  return { script, flag };
}

test('a tmux enumeration failure degrades one tick instead of ending the supervisor', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ao-supervise-degrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  const { script, flag } = await flakyTmux(root);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_TMUX_COMMAND: script };

  const controller = new AbortController();
  t.after(() => controller.abort());
  const ticks = [];
  let restored = false;
  const report = await superviseRepository(
    // A 1s contract is the floor presence allows, so the heartbeat beats every 333ms and the test
    // does not have to wait ten seconds to observe one degraded beat.
    { consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}`, staleAfterMs: 1000, clockSkewToleranceMs: 500 },
    { signal: controller.signal, intervalMs: 10, reconcileMinMs: 0, onTick: async tick => {
      ticks.push(tick);
      // Give tmux back only once the heartbeat has actually failed a beat and survived it, so the
      // recovery we then assert is a resumed heartbeat rather than one that never faltered.
      if (!restored && tick.presence_beats_degraded >= 1 && ticks.length >= 2) { await rm(flag, { force: true }); restored = true; }
      if ((restored && tick.reconciled) || ticks.length > 400) controller.abort();
    } },
  );

  // 1. It came back at all: before TM-141 this call REJECTED, which is the restart doctor counted.
  assert.ok(report, 'superviseRepository must return, not throw, when tmux cannot be enumerated');
  // 2. The failing ticks degraded, and said so.
  const degraded = ticks.filter(tick => tick.degraded === 'tmux-observation-failed');
  assert.ok(degraded.length >= 1, `expected a degraded tick, got ${JSON.stringify(ticks.map(t => t.degraded ?? t.reconciled))}`);
  assert.ok(degraded.every(tick => tick.reconciled === false), 'a degraded tick reconciled nothing and must not claim it did');
  // 3. The heartbeat absorbed its own failure rather than killing the process with it.
  assert.ok(ticks.at(-1).presence_beats_degraded >= 1, 'the presence heartbeat must record the beats it could not publish');
  // 4. And ONE tick was skipped, not the supervisor: a later tick reconciles with tmux back.
  const recovered = ticks.find(tick => tick.reconciled === true);
  assert.ok(recovered, 'the supervisor must reconcile again once tmux answers');
  assert.equal(recovered.degraded, undefined, 'a recovered tick must not carry the previous tick\'s degradation');
});

test('a one-shot supervise still fails loudly: it has no next tick to degrade into', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ao-supervise-once-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  const { script } = await flakyTmux(root);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_TMUX_COMMAND: script };
  await assert.rejects(
    superviseRepository({ consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}` }, { once: true }),
    { code: 'TOPOLOGY_TMUX_OBSERVATION_FAILED' },
  );
});

// ── TM-140 ─────────────────────────────────────────────────────────────────────────────────────

/** Acknowledge every lead nonce probe as the agent would. Assignment is a handshake; without an
 *  acker the CLI fails at TOPOLOGY_LEAD_HANDSHAKE_REQUIRED and never reaches the supervision line
 *  this test is about — which would make both surfaces "agree" for entirely the wrong reason. */
function ackProbes(dir, signal) {
  return (async () => {
    while (!signal.aborted) {
      for (const name of await readdir(dir).catch(() => [])) {
        if (!name.endsWith('.json') || name.endsWith('.ack.json')) continue;
        const probe = await readJson(join(dir, name)).catch(() => null);
        if (probe?.nonce) await writeJson(join(dir, `${probe.nonce}.ack.json`), { nonce: probe.nonce, repo_id: probe.repo_id, agent_id: probe.agent_id, at: new Date().toISOString() });
      }
      await sleep(25);
    }
  })();
}

test('lead assign and role assign lead answer a failed supervisor identically', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ao-lead-supervision-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home'), state = join(root, 'state'), tmuxTmp = join(root, 'tmux');
  await mkdir(tmuxTmp, { recursive: true });
  await mkdir(join(state, 'leads', 'probes'), { recursive: true });
  await run('git', ['init', '-q', repo]);
  // Supervision, and ONLY supervision, cannot start: a plain file where its directory belongs.
  // Every other state directory under the same root is untouched, so the assign itself succeeds
  // and the two surfaces are compared on the failure this test is actually about.
  await writeFile(join(state, 'supervision'), 'not a directory\n');
  const env = { ...process.env, TMUX: '', HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: state, TMUX_TMPDIR: tmuxTmp };
  assert.equal(env.TMUX, '', 'the real-tmux fixture must not inherit and destroy an operator tmux server');

  const cli = async args => {
    try { const { stdout } = await exec(process.execPath, [CLI, ...args, '--consumer', repo], { env }); return { code: 0, stdout }; }
    catch (error) { return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error.message) }; }
  };

  const minted = await cli(['agent', 'new', '--role', 'worker', '--name', 'Vera Lead']);
  assert.equal(minted.code, 0, minted.stderr);
  const agentId = JSON.parse(minted.stdout).id;

  const session = roleSessionName(agentId);
  await run('tmux', ['new-session', '-d', '-s', session, '-c', repo, 'sleep', '120'], { env });
  const socket = (await run('tmux', ['display-message', '-p', '-t', session, '#{socket_path}'], { env })).stdout.trim();
  t.after(() => run('tmux', ['-S', socket, 'kill-server'], { env, allowFailure: true }));
  const acker = new AbortController();
  const acking = ackProbes(join(state, 'leads', 'probes'), acker.signal);
  t.after(async () => { acker.abort(); await acking; });

  const surfaces = {
    'lead assign': await cli(['lead', 'assign', agentId]),
    'role assign lead': await cli(['role', 'assign', 'lead', agentId]),
  };
  for (const [name, result] of Object.entries(surfaces)) assert.equal(result.code, 0, `${name} exited ${result.code}: ${result.stderr}`);

  // Same operation, same shape of answer. `error` text differs by nothing that matters (both are
  // the same ENOTDIR), so the comparison is on the contract: did it start, and did it say why not.
  const shape = ([name, result]) => {
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.action, 'assigned', `${name} must have actually assigned; supervision is not the only way this can fail`);
    return [name, { started: parsed.supervision.started, reported: typeof parsed.supervision.error === 'string' && parsed.supervision.error.length > 0 }];
  };
  const answers = Object.fromEntries(Object.entries(surfaces).map(shape));
  assert.deepEqual(answers['lead assign'], answers['role assign lead'], 'two surfaces onto one operation must not differ on failure');
  assert.deepEqual(answers['lead assign'], { started: false, reported: true }, 'the agreed behaviour is to degrade and report, not to throw');
});
