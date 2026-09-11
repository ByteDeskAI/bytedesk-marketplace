// TM-167 on real tmux: an enrolled repository is activated by an ordinary verb and by a session start
// inside a real pane; an unenrolled one gets no supervisor; concurrent activations from linked worktrees
// leave exactly one supervisor process.
//
// Isolation, all three ways (.claude/rules/tmux-test-isolation.md): TMUX is blank, TMUX_TMPDIR is
// per-test, and the only kill-server is `-S <socket>` after asserting the socket is inside this test's
// own directory. Every `supervise` a test causes inherits that env, and ONE teardown hook reaps those
// supervisors before it kills the server and removes the directories they write into.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sleep, writeJson } from '../../topology/lib/util.mjs';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));
const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

async function supervisorsFor(consumer) {
  const { stdout } = await exec('pgrep', ['-f', `supervise --consumer ${consumer}( |$)`]).catch((error) => ({ stdout: error.stdout ?? '' }));
  return stdout.split('\n').filter(Boolean).map(Number);
}
async function reap(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 60; i++) { try { process.kill(pid, 0); } catch { return; } await sleep(50); }
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

async function fixture(t, label, { enrolled }) {
  try { await exec('tmux', ['-V']); } catch { t.skip('tmux unavailable'); return null; }
  // Short root: a tmux socket path must fit in sun_path.
  const root = await realpath(await mkdtemp(join(tmpdir(), `ao-act-${label}-`)));
  const repo = join(root, 'repo'), home = join(root, 'home'), tmuxTmp = join(root, 't'), socket = join(root, 's');
  await mkdir(tmuxTmp, { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_PANE: '', TMUX_TMPDIR: tmuxTmp, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  for (const key of ['AO_TMUX_COMMAND', 'AO_AGENT_ID', 'AO_SESSION', 'AO_CONSUMER', 'AO_LEAD_ID']) delete env[key];
  await exec('git', ['init', '-q', repo]);
  await exec('git', ['-C', repo, ...GIT_ID, 'commit', '--allow-empty', '-q', '-m', 'init']);
  if (enrolled) await writeJson(join(repo, '.bytedesk', 'agent-orchestration', 'config.json'), { enabled: true });

  t.after(async () => {
    for (const pid of await supervisorsFor(repo)) await reap(pid);
    assert.ok(env.TMUX === '' && socket.startsWith(`${root}/`), `refusing to kill a tmux server outside this test: ${socket}`);
    await exec('tmux', ['-S', socket, 'kill-server'], { env }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const ao = (args, cwd = repo) => exec(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 })
    .then(({ stdout }) => stdout);
  // A real SessionStart: `startup-check --source hook` run INSIDE a pane on the isolated server, so
  // it sees the $TMUX and $TMUX_PANE a real hook sees.
  const hook = join(root, 'hook.sh');
  await writeFile(hook, `#!/bin/sh\nout="$1"\n"${process.execPath}" "${CLI}" startup-check --source hook > "$out.tmp" 2> "$out.err"\nmv "$out.tmp" "$out"\nsleep 120\n`);
  await chmod(hook, 0o755);
  let panes = 0;
  const sessionStart = async (cwd) => {
    const out = join(root, `hook-${++panes}.json`);
    await exec('tmux', ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-s', `start-${panes}`, '-c', cwd, '/bin/sh', hook, out], { env });
    for (let i = 0; i < 300; i++) {
      const text = await readFile(out, 'utf8').catch(() => null);
      if (text !== null) return JSON.parse(text);
      await sleep(100);
    }
    assert.fail(`the in-pane startup-check never finished: ${await readFile(`${out}.err`, 'utf8').catch(() => '(no stderr)')}`);
  };
  const worktrees = async (n) => {
    const trees = [];
    for (let i = 0; i < n; i++) {
      const path = join(root, `wt${i}`);
      await exec('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', path]);
      trees.push(path);
    }
    return trees;
  };
  return { root, repo, env, socket, ao, sessionStart, worktrees };
}

test('an enrolled repository is activated by an ordinary verb and by a real session start', async (t) => {
  const f = await fixture(t, 'on', { enrolled: true });
  if (!f) return;
  const census = JSON.parse(await f.ao(['census', '--json']));
  assert.equal(census.supervision.enrolled, true);
  assert.equal(census.supervision.enrollment_source, 'repo-config');
  assert.equal(census.supervision.activation, 'census');
  assert.ok(Number.isInteger(census.supervision.pid), `census must have started a supervisor: ${JSON.stringify(census.supervision)}`);
  assert.deepEqual(await supervisorsFor(f.repo), [census.supervision.pid]);

  // Session start converges on the SAME supervisor rather than starting a second.
  const started = await f.sessionStart(f.repo);
  assert.equal(started.activation.reason, 'session-start');
  assert.equal(started.activation.enrollment.enrolled, true);
  assert.equal(started.activation.supervision.pid, census.supervision.pid);

  // And from cold: kill it, and a session start alone brings it back.
  for (const pid of await supervisorsFor(f.repo)) await reap(pid);
  assert.deepEqual(await supervisorsFor(f.repo), []);
  const cold = await f.sessionStart(f.repo);
  assert.ok(Number.isInteger(cold.activation.supervision.pid), `session start must start a supervisor from cold: ${JSON.stringify(cold.activation)}`);
  assert.deepEqual(await supervisorsFor(f.repo), [cold.activation.supervision.pid]);
});

test('an unenrolled repository gets no supervisor from a verb, a session start, or supervise itself', async (t) => {
  const f = await fixture(t, 'off', { enrolled: false });
  if (!f) return;
  const census = JSON.parse(await f.ao(['census', '--json']));
  assert.deepEqual({ started: census.supervision.started, reason: census.supervision.reason, enrolled: census.supervision.enrolled },
    { started: false, reason: 'not-enrolled', enrolled: false });
  const started = await f.sessionStart(f.repo);
  assert.deepEqual(started.activation.supervision, { started: false, reason: 'not-enrolled' });
  const supervise = (await f.ao(['supervise'])).trim().split('\n');
  assert.equal(supervise.length, 1);
  assert.equal(JSON.parse(supervise[0]).reason, 'repository-not-enrolled');
  await sleep(500);
  assert.deepEqual(await supervisorsFor(f.repo), [], 'no supervise process may exist for an unenrolled repository');
  assert.deepEqual((await readdir(join(f.root, 'state')).catch(() => [])).filter((name) => name === 'supervision' || name === 'presence'), []);
});

test('concurrent activations from linked worktrees leave exactly one supervisor process', async (t) => {
  const f = await fixture(t, 'many', { enrolled: true });
  if (!f) return;
  const trees = await f.worktrees(4);
  // Verbs from every checkout and two real session starts, all at once.
  const [verbs, hooks] = await Promise.all([
    Promise.all([f.repo, ...trees].map((cwd) => f.ao(['census', '--json'], cwd).then((stdout) => JSON.parse(stdout).supervision))),
    Promise.all([trees[0], trees[3]].map((cwd) => f.sessionStart(cwd).then((result) => result.activation.supervision))),
  ]);
  const reported = [...verbs, ...hooks];
  assert.ok(reported.every((s) => Number.isInteger(s.pid)), `every activation must report a supervisor: ${JSON.stringify(reported)}`);
  assert.equal(new Set(reported.map((s) => s.pid)).size, 1, `all activations must name one supervisor: ${JSON.stringify(reported.map((s) => s.pid))}`);
  await sleep(1000);
  const alive = await supervisorsFor(f.repo);
  assert.deepEqual(alive, [reported[0].pid], 'exactly one supervise process for the canonical repository');
  for (const tree of trees) assert.deepEqual(await supervisorsFor(tree), [], 'no supervisor may be keyed on a worktree path');
});
