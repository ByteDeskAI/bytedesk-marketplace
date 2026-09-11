// TM-167, criteria 2 and 6: activation is enrollment-gated, and no ordinary verb enumerates an unnamed
// tmux server.
//
// The scope guard drives the REAL CLI with a fake `tmux` first on PATH that only records its argv.
// Nothing here can reach a real tmux server — the fake never execs one — so this file is safe to run
// beside the operator's live sessions. Every verb case also asserts what it DID list, so a verb that
// silently stopped reaching tmux reads as a failure, not as a clean guard (verification rule 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, writeJson } from '../../topology/lib/util.mjs';
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
  const calls = await fake.calls();
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^-S \/named\/sock -u list-panes -a /);
  assert.match(calls[1], /^-u list-panes -s -t =ao-someone /);
  assert.deepEqual(unscoped(calls), []);
});

test('ordinary verbs never enumerate an unnamed tmux server', async (t) => {
  const { fake, ao } = await fixture(t);
  const created = await ao(['agent', 'new', '--role', 'worker', '--name', 'Scope Worker']);
  assert.equal(created.code, 0, created.stderr);
  const agentId = JSON.parse(created.stdout).id;
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
  // The coverage the assertions above rest on, printed so a vacuous pass is visible in the log.
  t.diagnostic(JSON.stringify(seen));
});

test('supervise in an unenrolled repository says so in one line, exits 0, and writes nothing', async (t) => {
  const { root, fake, ao } = await fixture(t);
  const started = Date.now();
  const result = await ao(['supervise']);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(Date.now() - started < 30_000, 'an unenrolled supervise must return, not idle');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `expected one line, got:\n${result.stdout}`);
  const said = JSON.parse(lines[0]);
  assert.deepEqual({ supervising: said.supervising, reason: said.reason, source: said.source }, { supervising: false, reason: 'repository-not-enrolled', source: 'none' });
  assert.deepEqual(await fake.calls(), [], 'no watcher, no presence, no census: nothing may touch tmux');
  const state = await readdir(join(root, 'state')).catch(() => []);
  assert.deepEqual(state, [], `an unenrolled supervise must not reconcile, publish, label or journal; state holds ${state.join(', ')}`);
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
