// TM-250: manage cutover and manage cut-release. Every refusal is named and runs nothing; the success
// path runs only the repository's own (fake) scripts, while shims for git, gh and systemctl on PATH
// record every argv, proving agent-orchestration itself never pushed, tagged or restarted a host.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { agentMarkers } from '../../topology/lib/delegation.mjs';
import { cutover, cutRelease, releaseReadiness } from '../../topology/lib/release.mjs';

const operatorEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !agentMarkers({ [k]: '1' }).length));
const OPERATOR = async () => ['zsh'];
const AGENT = async () => ['claude'];
const lines = async path => (await readFile(path, 'utf8').catch(() => '')).split('\n').filter(Boolean);

/** A develop checkout synced with a bare origin, its own fake deploy and release scripts committed,
 * and a task store whose epic EP-1 is fully landed unless a test says otherwise. */
export async function releaseFixture(t, { management = {}, global = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ao-release-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), origin = join(root, 'origin.git'), logs = join(root, 'logs'), shims = join(root, 'shims');
  await mkdir(logs); await mkdir(shims);
  const git = (args, cwd = consumer) => run('git', ['-C', cwd, ...args]);
  await run('git', ['init', '-q', '--bare', origin]);
  await run('git', ['init', '-q', '-b', 'develop', consumer]);
  await mkdir(join(consumer, 'scripts'));
  const script = (name, body) => writeFile(join(consumer, 'scripts', name), `#!/bin/sh\necho "$*" >> ${logs}/${name}.log\n${body}\n`, { mode: 0o755 });
  await writeFile(join(root, 'identity'), 'build-old\n');
  await script('deploy-safe.sh', `[ "$1" = deploy ] && echo build-new > ${root}/identity\n[ "$1" = postflight ] && exit "\${POSTFLIGHT_EXIT:-0}"\nexit 0`);
  await script('release-gitflow.sh', 'exit "${RELEASE_EXIT:-0}"');
  await writeJson(join(consumer, '.bytedesk/agent-orchestration/config.json'), { management: {
    cutover: { branch: 'develop', argv: ['scripts/deploy-safe.sh', 'deploy'], postflight_argv: ['scripts/deploy-safe.sh', 'postflight'], identity_argv: ['cat', join(root, 'identity')] },
    release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['scripts/release-gitflow.sh', 'verify'] },
    ...management } });
  await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'base']);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', '-q', 'origin', 'develop']);
  const config = join(root, 'config');
  if (global) await writeJson(join(config, 'agent-orchestration', 'config.json'), global);
  const tasks = { 'TM-1': 'done', 'TM-2': 'done' };
  const store = { epicTasks: async epic => (epic === 'EP-1' ? Object.keys(tasks) : []), show: async id => ({ id, status: tasks[id] }) };
  const options = { consumer, home: join(root, 'home'), env: { ...operatorEnv(), XDG_CONFIG_HOME: config, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') },
    ancestors: OPERATOR, store, epic: 'EP-1', authorized: true };
  return { root, consumer, logs, shims, git, tasks, options };
}

/** git, gh and systemctl shims that log their argv; git then runs the real git. */
async function shimPath(t, fx) {
  const realGit = (await run('sh', ['-c', 'command -v git'])).stdout.trim();
  const shim = (name, tail) => writeFile(join(fx.shims, name), `#!/bin/sh\necho "$*" >> ${fx.logs}/${name}.argv\n${tail}\n`, { mode: 0o755 });
  await shim('git', `exec ${realGit} "$@"`); await shim('gh', 'exit 0'); await shim('systemctl', 'exit 0');
  const saved = process.env.PATH; process.env.PATH = `${fx.shims}:${saved}`; t.after(() => { process.env.PATH = saved; });
  fx.options.env.PATH = process.env.PATH;
}

const refusedFor = async (promise, code, condition) => {
  const error = await promise.then(() => null, e => e);
  assert.ok(error, 'expected a refusal'); assert.equal(error.code, code, error.message);
  assert.ok(error.details.refusals.some(r => r.condition === condition), `${condition} named in: ${error.message}`);
  return error;
};
const nothingRan = async fx => {
  assert.deepEqual(await lines(join(fx.logs, 'deploy-safe.sh.log')), [], 'deploy-safe never ran');
  assert.deepEqual(await lines(join(fx.logs, 'release-gitflow.sh.log')), [], 'release never ran');
};

test('TM-250 success: cutover runs only deploy-safe, proves the binary switched, and never pushes, tags, calls gh or systemctl', async t => {
  const fx = await releaseFixture(t); await shimPath(t, fx);
  const result = await cutover(fx.options);
  assert.deepEqual(result.identity, { before: 'build-old', after: 'build-new' });
  assert.deepEqual(await lines(join(fx.logs, 'deploy-safe.sh.log')), ['deploy', 'postflight']);
  const gitArgv = await lines(join(fx.logs, 'git.argv'));
  assert.ok(gitArgv.length > 0, 'the git shim recorded calls, so absence below is meaningful');
  assert.equal(gitArgv.filter(a => /\b(push|tag|commit|merge|reset)\b/.test(a)).length, 0, gitArgv.join('\n'));
  assert.deepEqual(await lines(join(fx.logs, 'gh.argv')), []); assert.deepEqual(await lines(join(fx.logs, 'systemctl.argv')), []);
  assert.equal(result.authorization.channel, 'operator-explicit'); assert.equal(result.authorization.class, 'external');
  assert.match(await readFile(result.path, 'utf8'), /build-new/);
});

test('TM-250 success: cut-release runs the release script then its verify, and agent-orchestration pushes nothing itself', async t => {
  const fx = await releaseFixture(t); await shimPath(t, fx);
  const result = await cutRelease(fx.options);
  assert.equal(result.verified, true);
  assert.deepEqual(await lines(join(fx.logs, 'release-gitflow.sh.log')), ['start', 'verify']);
  assert.equal((await lines(join(fx.logs, 'git.argv'))).filter(a => /\b(push|tag)\b/.test(a)).length, 0);
  assert.deepEqual(await lines(join(fx.logs, 'gh.argv')), []);
});

test('TM-250 refusal branch: a checkout not on develop runs nothing', async t => {
  const fx = await releaseFixture(t);
  await fx.git(['checkout', '-q', '-b', 'feature']);
  await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'branch');
  await refusedFor(cutRelease(fx.options), 'TOPOLOGY_RELEASE_REFUSED', 'branch');
  await nothingRan(fx);
});

test('TM-250 refusal sync: develop ahead of origin/develop runs nothing', async t => {
  const fx = await releaseFixture(t);
  await fx.git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'unpushed']);
  await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'sync');
  await nothingRan(fx);
});

test('TM-250 refusal dirty: uncommitted work, including an edited AO config, runs nothing', async t => {
  const fx = await releaseFixture(t);
  await writeFile(join(fx.consumer, '.bytedesk/agent-orchestration/config.json'), '{"management":{}}');
  await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'dirty');
  await nothingRan(fx);
});

test('TM-250 refusal plan: no epic named, or an epic task not landed, runs nothing', async t => {
  const fx = await releaseFixture(t);
  await refusedFor(cutRelease({ ...fx.options, epic: null }), 'TOPOLOGY_RELEASE_REFUSED', 'plan');
  fx.tasks['TM-2'] = 'in_progress';
  const error = await refusedFor(cutRelease(fx.options), 'TOPOLOGY_RELEASE_REFUSED', 'plan');
  assert.match(error.message, /TM-2 \(in_progress\)/);
  await nothingRan(fx);
});

test('TM-250 refusal authority: no --authorized, or --authorized from a managed agent session, runs nothing', async t => {
  const fx = await releaseFixture(t);
  await refusedFor(cutover({ ...fx.options, authorized: false }), 'TOPOLOGY_CUTOVER_REFUSED', 'authority');
  const error = await refusedFor(cutover({ ...fx.options, ancestors: AGENT }), 'TOPOLOGY_CUTOVER_REFUSED', 'authority');
  assert.match(error.message, /cannot be self-asserted inside a managed agent session/);
  await nothingRan(fx);
});

for (const [exe, argv] of [['systemctl', ['systemctl', '--user', 'restart', 'gateway']], ['git', ['git', 'push', 'origin', 'v1.0.0']], ['gh', ['gh', 'release', 'create']], ['sh', ['sh', '-c', 'git push']]]) {
  test(`TM-250 refusal config: a configured step that runs ${exe} directly is refused and runs nothing`, async t => {
    const fx = await releaseFixture(t, { management: { cutover: { branch: 'develop', argv, identity_argv: ['true'] }, release: { branch: 'develop', argv, verify_argv: ['true'] } } });
    const error = await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'config');
    assert.match(error.message, new RegExp(`runs ${exe} directly`));
    await refusedFor(cutRelease(fx.options), 'TOPOLOGY_RELEASE_REFUSED', 'config');
  });
}

test('TM-250 refusal config: a missing cutover identity probe is refused, since a switch could not be proven', async t => {
  const fx = await releaseFixture(t, { management: { cutover: { branch: 'develop', argv: ['scripts/deploy-safe.sh', 'deploy'] } } });
  const error = await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'config');
  assert.match(error.message, /identity_argv/);
  await nothingRan(fx);
});

test('TM-250 cutover refuses a binary that did not switch, and a failed postflight', async t => {
  const fx = await releaseFixture(t, { management: { cutover: { branch: 'develop', argv: ['scripts/deploy-safe.sh', 'stage'], identity_argv: ['cat', 'scripts/deploy-safe.sh'] } } });
  await assert.rejects(cutover(fx.options), { code: 'TOPOLOGY_CUTOVER_NOT_SWITCHED' });
  const failing = await releaseFixture(t);
  failing.options.env.POSTFLIGHT_EXIT = '3';
  await assert.rejects(cutover(failing.options), { code: 'TOPOLOGY_CUTOVER_POSTFLIGHT' });
});

test('TM-250 cut-release refuses a failed release step and an unverified published result', async t => {
  const fx = await releaseFixture(t);
  fx.options.env.RELEASE_EXIT = '1';
  await assert.rejects(cutRelease(fx.options), { code: 'TOPOLOGY_RELEASE_FAILED' });
  const unverified = await releaseFixture(t, { management: { release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['false'] } } });
  await assert.rejects(cutRelease(unverified.options), { code: 'TOPOLOGY_RELEASE_POSTFLIGHT' });
});

test('TM-250 readiness names every failing condition at once', async t => {
  const fx = await releaseFixture(t);
  await fx.git(['checkout', '-q', '-b', 'feature']);
  const gate = await releaseReadiness({ ...fx.options, authorized: false, epic: null }, 'cutover');
  assert.deepEqual([...new Set(gate.refusals.map(r => r.condition))].sort(), ['authority', 'branch', 'plan']);
});
