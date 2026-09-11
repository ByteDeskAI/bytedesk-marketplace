// TM-167, criteria 2 and 6: activation is enrollment-gated, and no ordinary verb enumerates an unnamed
// tmux server.
//
// The scope guard drives the REAL CLI with a fake `tmux` first on PATH that only records its argv.
// Nothing here can reach a real tmux server — the fake never execs one — so this file is safe to run
// beside the operator's live sessions. Every verb case also asserts what it DID list, so a verb that
// silently stopped reaching tmux reads as a failure, not as a clean guard (verification rule 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, sleep, writeJson } from '../../topology/lib/util.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { listServerPanes } from '../../topology/lib/tmux.mjs';
import { pendingEnrollments, watchServer } from '../../topology/lib/startup.mjs';

const CLI = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));

/** A tmux that records argv and answers nothing. has-session / display-message fail, so no session "exists". */
async function fakeTmux(root) {
  const bin = join(root, 'bin'), log = join(root, 'tmux-calls.log');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'tmux'), `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case " $* " in
  *" has-session "*|*" display-message "*) exit 1 ;;
  *" -V "*) echo "tmux 3.4"; exit 0 ;;
esac
exit 0
`);
  await chmod(join(bin, 'tmux'), 0o755);
  return {
    bin, log,
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean),
    reset: () => writeFile(log, ''),
  };
}

/** A pane enumeration with no -L/-S and no session target: the thing criterion 6 forbids. */
const unscoped = (calls) => calls.filter((line) => /(^| )list-panes( |$)/.test(line) && !/(^| )-[LS] /.test(line) && !/ -t =/.test(line));
const listings = (calls) => calls.filter((line) => /(^| )list-panes( |$)/.test(line));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-activation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  await mkdir(join(root, 'tmux'), { recursive: true });
  const fake = await fakeTmux(root);
  const env = { ...process.env, PATH: `${fake.bin}:${process.env.PATH}`, TMUX: '', TMUX_PANE: '', TMUX_TMPDIR: join(root, 'tmux'),
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.state'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  for (const key of ['AO_TMUX_COMMAND', 'AO_AGENT_ID', 'AO_SESSION', 'AO_CONSUMER', 'AO_LEAD_ID']) delete env[key];
  const ao = (args, extra = {}) => new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000 },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });
  return { root, repo, home, env, fake, ao };
}

test('listServerPanes refuses an unnamed server and scopes every listing it does make', async (t) => {
  const { env, fake } = await fixture(t);
  await assert.rejects(listServerPanes({ env }), (error) => error.code === 'TOPOLOGY_TMUX_SERVER_REQUIRED');
  assert.deepEqual(await fake.calls(), [], 'a refused enumeration must not reach tmux at all');
  await listServerPanes({ env, tmuxServer: '/named/sock' });
  await listServerPanes({ env, session: 'ao-someone' });
  await listServerPanes({ env, tmuxServer: '/named/sock', session: 'ao-someone' });
  const calls = await fake.calls();
  assert.equal(calls.length, 3);
  assert.match(calls[0], /^-S \/named\/sock -u list-panes -a /);
  // Session only, under TMUX: '' — the server is implicit (no -L/-S): the documented ceiling.
  assert.equal(env.TMUX, '');
  assert.match(calls[1], /^-u list-panes -s -t =ao-someone /);
  // Session plus a recorded server: both scopes travel together.
  assert.match(calls[2], /^-S \/named\/sock -u list-panes -s -t =ao-someone /);
  assert.deepEqual(unscoped(calls), []);
});

test('ordinary verbs never enumerate an unnamed tmux server', async (t) => {
  const { fake, ao } = await fixture(t);
  const created = await ao(['agent', 'new', '--role', 'worker', '--name', 'Scope Worker']);
  assert.equal(created.code, 0, created.stderr);
  const { id: agentId, dir: agentDir } = JSON.parse(created.stdout);
  const callerTmux = { TMUX: '/fake/caller.sock,4242,0', TMUX_PANE: '%9' };
  // [verb argv, extra env, what it must have listed: 'none' | a regex every listing must match]
  const cases = [
    [['census', '--json'], {}, 'none'],
    [['prompt', 'refresh', agentId], {}, 'none'],
    [['prompt', 'ack', agentId, '--revision', 'r', '--nonce', 'n'], { TMUX_PANE: '%9' }, 'none'],
    [['prompt', 'ack', agentId, '--revision', 'r', '--nonce', 'n'], callerTmux, /^-S \/fake\/caller\.sock /],
    [['startup-check', '--source', 'hook'], {}, 'none'],
    [['startup-check', '--source', 'hook'], callerTmux, /^-S \/fake\/caller\.sock /],
    [['role', 'status', 'worker'], {}, new RegExp(`list-panes -s -t =ao-${agentId} `)],
    [['supervise', '--once'], {}, 'none'],
  ];
  const seen = [];
  for (const [argv, extra, expected] of cases) {
    await fake.reset();
    const result = await ao(argv, extra);
    const calls = await fake.calls();
    seen.push({ verb: argv.slice(0, 2).join(' '), code: result.code, listings: listings(calls) });
    assert.deepEqual(unscoped(calls), [], `${argv.join(' ')} enumerated an unnamed server:\n${calls.join('\n')}`);
    if (expected === 'none') assert.deepEqual(listings(calls), [], `${argv.join(' ')} has no named server and must list nothing`);
    else {
      assert.ok(listings(calls).length >= 1, `${argv.join(' ')} should have listed its named scope; stderr: ${result.stderr}`);
      for (const line of listings(calls)) assert.match(line, expected);
    }
  }
  // A session name alone leaves the server implicit (the role status case above). Once the agent's
  // session record names its server, the per-session query must carry that server as well.
  await writeJson(join(agentDir, 'session.json'), { agent_id: agentId, session: `ao-${agentId}`,
    binding: { serverKey: '/fake/role.sock', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 2 } });
  await fake.reset();
  await ao(['role', 'status', 'worker']);
  const bound = listings(await fake.calls());
  seen.push({ verb: 'role status (recorded server)', listings: bound });
  assert.ok(bound.length >= 1, 'role status with a recorded binding must still list its session');
  for (const line of bound) assert.match(line, new RegExp(`^-S /fake/role\\.sock -u list-panes -s -t =ao-${agentId} `));
  // The coverage the assertions above rest on, printed so a vacuous pass is visible in the log.
  t.diagnostic(JSON.stringify(seen));
});

/** SIGTERM, then SIGKILL, and wait until the pid is really gone — before its state dir is removed. */
async function reap(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 60; i++) { try { process.kill(pid, 0); } catch { return; } await sleep(50); }
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

test('supervise in an unenrolled repository runs read-only: it publishes presence and never starts a lead or agent', async (t) => {
  const { root, repo, env, fake } = await fixture(t);
  const child = spawn(process.execPath, [CLI, 'supervise', '--consumer', repo], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  // Reap in `finally`, not t.after: the fixture registered rm(root) first, and hooks run in order.
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const presence = join(root, 'state', 'presence');
    let published = [];
    for (let i = 0; i < 200 && !published.length; i++) {
      await sleep(100);
      published = (await readdir(presence, { recursive: true }).catch(() => [])).filter((name) => name.endsWith('.json'));
    }
    assert.ok(published.length >= 1, `an unenrolled repository's supervisor must still publish presence; it said:\n${log.join('')}`);
    assert.equal(child.exitCode, null, `and keep running rather than exit; it said:\n${log.join('')}`);
    const calls = await fake.calls();
    const starts = calls.filter((line) => /(^| )(new-session|new-window|split-window|respawn-pane|send-keys|kill-session|kill-server)( |$)/.test(line));
    assert.deepEqual(starts, [], 'a read-only supervisor may observe tmux but must never start, restart, type into or kill anything');
    assert.deepEqual(unscoped(calls), []);
    for (const dir of ['leads', 'reviewers', join('enrollments', 'enrolled')]) {
      assert.deepEqual((await readdir(join(root, 'state', dir)).catch(() => [])).filter((name) => name.endsWith('.json')), [], `no ${dir} record may be created in an unenrolled repository`);
    }
  } finally {
    await reap(child.pid);
  }
});

test('supervise --once still reconciles an enrolled repository', async (t) => {
  const { root, repo, ao } = await fixture(t);
  await writeJson(join(repo, '.bytedesk/agent-orchestration/config.json'), { enabled: true });
  const result = await ao(['supervise', '--once']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).reconciled, true);
  assert.ok((await readdir(join(root, 'state', 'supervision'))).some((name) => name.endsWith('.json')));
});

function pane(cwd, sessionName, paneId) {
  return { serverKey: 'server-a', serverPid: 1, sessionId: `$${sessionName}`, sessionCreated: 100, paneId, panePid: 2, sessionName, command: 'claude', cwd, alive: true };
}

test("a per-repository watcher labels only its own repository's panes", async (t) => {
  const { root } = await fixture(t);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const mine = join(root, 'mine'), other = join(root, 'other');
  await run('git', ['init', '-q', mine]); await run('git', ['init', '-q', other]);
  const [idMine, idOther] = [(await canonicalRepoId(mine)).id, (await canonicalRepoId(other)).id];
  const listPanesFn = async () => [pane(mine, 'mine-work', '%1'), pane(other, 'other-work', '%2')];

  const scoped = await watchServer({ env, once: true, tmuxServer: 'server-a', repoId: idMine, listPanesFn });
  assert.deepEqual(scoped.labelled, ['mine-work']);
  assert.deepEqual((await pendingEnrollments({ env })).map((r) => r.repo_id), [idMine]);
  assert.deepEqual(await readdir(join(root, 'state', 'startup')), [`${repoKey(idMine)}.jsonl`], 'another repository must get no journal entry');

  // Control: the same listing WITHOUT repoId labels both, so the filter is what excluded the other repo.
  const hostWide = await watchServer({ env, once: true, tmuxServer: 'server-a', listPanesFn });
  assert.deepEqual(hostWide.labelled.sort(), ['mine-work', 'other-work']);
  assert.ok((await pendingEnrollments({ env })).some((r) => r.repo_id === idOther));
});
