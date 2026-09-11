// TM-167, criteria 1 and 2: one enrollment resolver, and activation that starts exactly one canonical
// supervisor — or none at all for a repository that is not enrolled.
//
// Tests that start a real `supervise` daemon isolate it the three ways .claude/rules/tmux-test-isolation.md
// requires (TMUX blank, a per-test TMUX_TMPDIR, and no bare kill-server anywhere), and tear down in ONE
// hook that reaps every supervisor the repository caused BEFORE removing the directories it writes into.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sleep, writeJson } from '../../topology/lib/util.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { leadRegistryDir } from '../../topology/lib/lead.mjs';
import { validateConfigShape } from '../../topology/lib/config.mjs';
import { activateRepository, resolveEnrollment } from '../../topology/lib/repo-enrollment.mjs';
import { startupCheck } from '../../topology/lib/startup.mjs';

const exec = promisify(execFile);
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

async function repoFixture(t, label) {
  const root = await realpath(await mkdtemp(join(tmpdir(), `ao-enroll-${label}-`)));
  const repo = join(root, 'repo'), home = join(root, 'home'), tmux = join(root, 'tmux');
  mkdirSync(tmux, { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_PANE: '', TMUX_TMPDIR: tmux, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  for (const key of ['AO_TMUX_COMMAND', 'AO_LEAD_ID', 'AO_AGENT_ID']) delete env[key];
  await exec('git', ['init', '-q', repo]);
  await exec('git', ['-C', repo, ...GIT_ID, 'commit', '--allow-empty', '-q', '-m', 'init']);
  t.after(async () => {
    for (const pid of await supervisorsFor(repo)) await reap(pid);
    await rm(root, { recursive: true, force: true });
  });
  const configPath = join(repo, '.bytedesk', 'agent-orchestration', 'config.json');
  const settingsPath = join(repo, '.claude', 'settings.json');
  return {
    root, repo, home, env,
    identity: await canonicalRepoId(repo),
    setConfig: async (value) => { if (value === undefined) return rm(configPath, { force: true }); await mkdir(join(repo, '.bytedesk', 'agent-orchestration'), { recursive: true }); return typeof value === 'string' ? writeFile(configPath, value) : writeJson(configPath, value); },
    setPlugins: async (enabledPlugins) => { if (enabledPlugins === undefined) return rm(settingsPath, { force: true }); return writeJson(settingsPath, { enabledPlugins }); },
    setLead: async (present) => {
      const path = join(leadRegistryDir(env, home), `${repoKey((await canonicalRepoId(repo)).id)}.json`);
      if (!present) return rm(path, { force: true });
      return writeJson(path, { repo_id: (await canonicalRepoId(repo)).id, agent_id: 'lead0001', session: 'ao-lead0001' });
    },
  };
}

test('enrollment precedence: enabled:false wins, then repo config, project plugin, lead registration, none', async (t) => {
  const f = await repoFixture(t, 'precedence');
  const PLUGIN = { 'agent-orchestration@bytedesk': true };
  // [label, repo config, enabledPlugins, lead registration, expected source, expected enrolled, reason pattern]
  const cases = [
    ['nothing', undefined, undefined, false, 'none', false],
    ['lead registration only', undefined, undefined, true, 'lead-registration', true],
    ['plugin beats lead registration', undefined, PLUGIN, true, 'project-plugin', true],
    ['any marketplace suffix', undefined, { 'agent-orchestration@some-other-marketplace': true }, false, 'project-plugin', true],
    ['a different plugin name does not match', undefined, { 'agent-orchestration-extras@bytedesk': true, 'task-management@bytedesk': true }, false, 'none', false],
    ['explicit plugin false does not disable', undefined, { 'agent-orchestration@bytedesk': false }, true, 'lead-registration', true],
    ['explicit plugin false alone is just none', undefined, { 'agent-orchestration@bytedesk': false }, false, 'none', false],
    ['repo config true', { enabled: true }, undefined, false, 'repo-config', true],
    ['repo config true beats plugin', { enabled: true }, PLUGIN, true, 'repo-config', true],
    ['repo config without enabled falls through', { prompts: {} }, PLUGIN, false, 'project-plugin', true],
    ['enabled:false beats plugin AND lead registration', { enabled: false }, PLUGIN, true, 'disabled', false, /sets enabled:false/],
    ['non-boolean enabled fails closed', { enabled: 'yes' }, PLUGIN, true, 'disabled', false, /must be true or false/],
    ['numeric enabled fails closed', { enabled: 1 }, PLUGIN, true, 'disabled', false, /must be true or false/],
    ['unparseable repo config fails closed', '{ "enabled": tru', PLUGIN, true, 'disabled', false, /unreadable/],
    ['non-object repo config fails closed', '[true]', PLUGIN, true, 'disabled', false, /not a JSON object/],
  ];
  const answers = [];
  for (const [label, config, plugins, lead, source, enrolled, reason] of cases) {
    await f.setConfig(config); await f.setPlugins(plugins); await f.setLead(lead);
    const got = await resolveEnrollment({ consumer: f.repo, env: f.env, home: f.home });
    answers.push(`${label}: ${got.source}`);
    assert.equal(got.source, source, `${label}: ${JSON.stringify(got)}`);
    assert.equal(got.enrolled, enrolled, label);
    assert.equal(got.repo_id, f.identity.id, label);
    assert.equal(got.root, f.repo, label);
    if (reason) assert.match(got.reason ?? '', reason, label);
  }
  t.diagnostic(answers.join(' | '));
});

test('validateConfigShape reports a non-boolean enabled and accepts a boolean one', () => {
  assert.deepEqual(validateConfigShape({ enabled: true }, 'x'), []);
  assert.deepEqual(validateConfigShape({ enabled: false }, 'x'), []);
  assert.deepEqual(validateConfigShape({ enabled: 'yes' }, 'x'), ['x: "enabled" must be true or false']);
});

test('every linked worktree resolves from the canonical root, whatever its own checkout holds', async (t) => {
  const f = await repoFixture(t, 'worktrees');
  const trees = [];
  for (const name of ['wt-a', 'wt-b', 'wt-c']) {
    const path = join(f.root, name);
    await exec('git', ['-C', f.repo, 'worktree', 'add', '-q', '--detach', path]);
    trees.push(path);
  }
  await f.setConfig({ enabled: true });
  // A worktree-local config saying the opposite must not split the answer: only the canonical root counts.
  await mkdir(join(trees[0], '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeJson(join(trees[0], '.bytedesk', 'agent-orchestration', 'config.json'), { enabled: false });
  await mkdir(join(trees[1], 'deep', 'dir'), { recursive: true });
  const answers = await Promise.all([f.repo, ...trees, join(trees[1], 'deep', 'dir')].map((consumer) => resolveEnrollment({ consumer, env: f.env, home: f.home })));
  for (const answer of answers) assert.deepEqual(answer, { enrolled: true, source: 'repo-config', repo_id: f.identity.id, root: f.repo });

  await f.setConfig({ enabled: false });
  const disabled = await Promise.all(trees.map((consumer) => resolveEnrollment({ consumer, env: f.env, home: f.home })));
  assert.ok(disabled.every((answer) => answer.source === 'disabled' && answer.root === f.repo));
});

test('a disabled or unenrolled repository is never activated, by a verb or by session start', async (t) => {
  const f = await repoFixture(t, 'disabled');
  for (const [config, lead] of [[{ enabled: false }, true], [undefined, false]]) {
    await f.setConfig(config); await f.setLead(lead);
    const activation = await activateRepository({ consumer: f.repo, env: f.env, home: f.home, reason: 'test' });
    assert.deepEqual(activation.supervision, { started: false, reason: 'not-enrolled' });
    assert.equal(activation.enrollment.enrolled, false);
    const started = await startupCheck({ consumer: f.repo, source: 'hook', env: f.env, home: f.home, readinessFn: async () => ({ state: 'test' }) });
    assert.deepEqual(started.activation.supervision, { started: false, reason: 'not-enrolled' });
    assert.equal(started.activation.reason, 'session-start');
  }
  await sleep(300);
  assert.deepEqual(await supervisorsFor(f.repo), [], 'no supervisor process may exist for a repository that is not enrolled');
  assert.deepEqual((await readdir(join(f.root, 'state')).catch(() => [])).filter((name) => name === 'supervision'), []);
});

test('activateRepository never throws, even when enrollment cannot be resolved', async (t) => {
  const f = await repoFixture(t, 'nothrow');
  const answer = await activateRepository({ consumer: join(f.root, 'does-not-exist'), env: f.env, home: f.home });
  assert.equal(answer.enrollment.enrolled, false);
  assert.equal(answer.supervision.started, false);
});

test('session start activates an enrolled repository, and N concurrent linked-worktree activations converge on one supervisor', async (t) => {
  const f = await repoFixture(t, 'converge');
  const trees = [];
  for (const name of ['wt-1', 'wt-2', 'wt-3']) {
    const path = join(f.root, name);
    await exec('git', ['-C', f.repo, 'worktree', 'add', '-q', '--detach', path]);
    trees.push(path);
  }
  await f.setPlugins({ 'agent-orchestration@bytedesk': true });

  const session = await startupCheck({ consumer: trees[0], source: 'hook', env: f.env, home: f.home, readinessFn: async () => ({ state: 'test' }) });
  assert.equal(session.activation.enrollment.source, 'project-plugin');
  const first = session.activation.supervision;
  assert.ok(Number.isInteger(first.pid), `session start must have started a supervisor: ${JSON.stringify(first)}`);

  const consumers = [f.repo, ...trees, f.repo, trees[2]];
  const results = await Promise.all(consumers.map((consumer, i) => activateRepository({ consumer, env: f.env, home: f.home, reason: `concurrent-${i}` })));
  const pids = new Set(results.map((result) => result.supervision.pid));
  assert.deepEqual([...pids], [first.pid], `every activation must name the one supervisor: ${JSON.stringify(results.map((r) => r.supervision))}`);
  await sleep(500);
  assert.deepEqual(await supervisorsFor(f.repo), [first.pid], 'exactly one supervise process for the canonical repository');
  for (const tree of trees) assert.deepEqual(await supervisorsFor(tree), [], 'no supervisor may be keyed on a linked worktree path');
});
