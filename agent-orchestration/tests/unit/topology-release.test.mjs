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
import { autonomyOf, loadConfig } from '../../topology/lib/config.mjs';
import { teamcityClient, teamcityTarget } from '../../topology/lib/teamcity.mjs';
import { page, ntfyTarget } from '../../topology/lib/ntfy.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plantGitVectors } from '../helpers/plant-git-vectors.mjs';

const operatorEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !agentMarkers({ [k]: '1' }).length));
const OPERATOR = async () => ['zsh'];
const AGENT = async () => ['claude'];
const lines = async path => (await readFile(path, 'utf8').catch(() => '')).split('\n').filter(Boolean);

/** A develop checkout synced with a bare origin, its own fake deploy and release scripts committed,
 * and a task store whose epic EP-1 is fully landed unless a test says otherwise. */
/** TM-442: a fake gh for the pinned repository o/r whose default-branch config is `doc()`. */
export const serverGh = doc => async args => {
  if (args[0] === 'repo' && args[1] === 'view') return { code: 0, stdout: JSON.stringify({ nameWithOwner: 'o/r', defaultBranchRef: { name: 'develop' } }), stderr: '' };
  if (args[0] === 'api' && args[1] === 'repos/o/r/contents/.bytedesk/agent-orchestration/config.json?ref=develop') return { code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify(await doc())).toString('base64') }), stderr: '' };
  return { code: 1, stdout: '', stderr: `fixture gh: ${args.join(' ')}` };
};
export const SERVER_SOURCE = 'o/r@develop:.bytedesk/agent-orchestration/config.json';

/** `policy` adds management keys only the server's default branch carries (TM-442: protected keys are
 * honoured only from there); `global` writes the operator-writable global layer, which is not. */
export async function releaseFixture(t, { management = {}, global = null, policy = {} } = {}) {
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
  await script('identity.sh', `cat ${root}/identity`);
  await script('static-identity.sh', 'echo build-static');
  await script('fails.sh', 'exit 1');
  const committed = { management: {
    cutover: { branch: 'develop', argv: ['scripts/deploy-safe.sh', 'deploy'], postflight_argv: ['scripts/deploy-safe.sh', 'postflight'], identity_argv: ['scripts/identity.sh'] },
    release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['scripts/release-gitflow.sh', 'verify'] },
    ...management } };
  await writeJson(join(consumer, '.bytedesk/agent-orchestration/config.json'), committed);
  await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'base']);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', '-q', 'origin', 'develop']);
  const config = join(root, 'config');
  if (global) await writeJson(join(config, 'agent-orchestration', 'config.json'), global);
  const tasks = { 'TM-1': 'done', 'TM-2': 'done' };
  const store = { epicTasks: async epic => (epic === 'EP-1' ? Object.keys(tasks) : []), show: async id => ({ id, status: tasks[id] }) };
  const server = { management: { ...committed.management, ...policy } };
  const options = { consumer, home: join(root, 'home'), env: { ...operatorEnv(), XDG_CONFIG_HOME: config, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') },
    ancestors: OPERATOR, store, epic: 'EP-1', authorized: true, gh: serverGh(() => server) };
  return { root, consumer, logs, shims, git, tasks, options, server };
}

/** git, gh and systemctl shims that log their argv; git then runs the real git. */
async function shimPath(t, fx) {
  const realGit = (await run('sh', ['-c', 'command -v git'])).stdout.trim();
  const shim = (name, tail) => writeFile(join(fx.shims, name), `#!/bin/sh\necho "$*" >> ${fx.logs}/${name}.argv\n${tail}\n`, { mode: 0o755 });
  // git logs its argv unit-separated (TM-443 adds `-c key=value` pairs whose values hold spaces).
  await writeFile(join(fx.shims, 'git'), `#!/bin/sh\nprintf '%s\\037' "$@" >> ${fx.logs}/git.argv\necho >> ${fx.logs}/git.argv\nexec ${realGit} "$@"\n`, { mode: 0o755 });
  await shim('gh', 'exit 0'); await shim('systemctl', 'exit 0');
  const saved = process.env.PATH; process.env.PATH = `${fx.shims}:${saved}`; t.after(() => { process.env.PATH = saved; });
  fx.options.env.PATH = process.env.PATH;
}

/** TM-443: the git subcommand of each logged call, past the safe-git `-c` pairs and `-C <dir>`. */
const gitSubcommands = async path => (await lines(path)).map(line => {
  const argv = line.split('\x1f').filter((_, i, all) => i < all.length - 1 || all[i] !== '');
  let i = 0; while (i < argv.length && ['-c', '-C'].includes(argv[i])) i += 2;
  return argv[i];
});

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
  const gitArgv = await gitSubcommands(join(fx.logs, 'git.argv'));
  assert.ok(gitArgv.length > 0 && gitArgv.includes('fetch'), 'the git shim recorded calls, so absence below is meaningful');
  assert.equal(gitArgv.filter(a => ['push', 'tag', 'commit', 'merge', 'reset'].includes(a)).length, 0, gitArgv.join('\n'));
  assert.deepEqual(await lines(join(fx.logs, 'gh.argv')), []); assert.deepEqual(await lines(join(fx.logs, 'systemctl.argv')), []);
  assert.equal(result.authorization.channel, 'operator-explicit'); assert.equal(result.authorization.class, 'external');
  assert.match(await readFile(result.path, 'utf8'), /build-new/);
});

test('TM-250 success: cut-release runs the release script then its verify, and agent-orchestration pushes nothing itself', async t => {
  const fx = await releaseFixture(t); await shimPath(t, fx);
  const result = await cutRelease(fx.options);
  assert.equal(result.verified, true);
  assert.deepEqual(await lines(join(fx.logs, 'release-gitflow.sh.log')), ['start', 'verify']);
  const gitArgv = await gitSubcommands(join(fx.logs, 'git.argv'));
  assert.ok(gitArgv.includes('fetch')); assert.equal(gitArgv.filter(a => ['push', 'tag'].includes(a)).length, 0, gitArgv.join('\n'));
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
    const fx = await releaseFixture(t, { management: { cutover: { branch: 'develop', argv, identity_argv: ['scripts/identity.sh'] }, release: { branch: 'develop', argv, verify_argv: ['scripts/release-gitflow.sh'] } } });
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
  const fx = await releaseFixture(t, { management: { cutover: { branch: 'develop', argv: ['scripts/deploy-safe.sh', 'stage'], identity_argv: ['scripts/static-identity.sh'] } } });
  await assert.rejects(cutover(fx.options), { code: 'TOPOLOGY_CUTOVER_NOT_SWITCHED' });
  const failing = await releaseFixture(t);
  failing.options.env.POSTFLIGHT_EXIT = '3';
  await assert.rejects(cutover(failing.options), { code: 'TOPOLOGY_CUTOVER_POSTFLIGHT' });
});

test('TM-250 cut-release refuses a failed release step and an unverified published result', async t => {
  const fx = await releaseFixture(t);
  fx.options.env.RELEASE_EXIT = '1';
  await assert.rejects(cutRelease(fx.options), { code: 'TOPOLOGY_RELEASE_FAILED' });
  const unverified = await releaseFixture(t, { management: { release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['scripts/fails.sh'] } } });
  await assert.rejects(cutRelease(unverified.options), { code: 'TOPOLOGY_RELEASE_POSTFLIGHT' });
});

test('TM-250 readiness names every failing condition at once', async t => {
  const fx = await releaseFixture(t);
  await fx.git(['checkout', '-q', '-b', 'feature']);
  const gate = await releaseReadiness({ ...fx.options, authorized: false, epic: null }, 'cutover');
  assert.deepEqual([...new Set(gate.refusals.map(r => r.condition))].sort(), ['authority', 'branch', 'plan']);
});

// ── TM-368: the autonomy policy, TeamCity wait, ntfy pages ───────────────────────────────────────
const TC = { build_type: 'Gateway_ReleasePublish', poll_ms: 1, timeout_ms: 1000 };
const tcEnv = { TEAMCITY_URL: 'https://teamcity.invalid', TEAMCITY_TOKEN: 'tc-secret' };
/** A TeamCity stub: build 7 exists before the release; build 8 appears once the release ran. */
const fakeTeamcity = (status = 'SUCCESS') => {
  const seen = [];
  return { seen, latestBuildId: async bt => { seen.push(['latest', bt]); return 7; },
    waitForBuild: async args => { seen.push(['wait', args.buildType, args.after, args.revisions]); return { id: 8, number: '1.4.0', state: 'finished', status, statusText: status === 'SUCCESS' ? 'ok' : 'Tests failed: 3', webUrl: 'https://teamcity.invalid/build/8', branchName: 'develop', revision: args.revisions[0] }; } };
};
const pager = () => { const pages = []; return { pages, page: async msg => { pages.push(msg); return { sent: true }; } }; };
const publishFixture = async (t, extra = {}) => {
  const fx = await releaseFixture(t, { management: { release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['scripts/release-gitflow.sh', 'verify'], teamcity: TC } },
    policy: { autonomy: 'publish' }, ...extra });
  Object.assign(fx.options.env, tcEnv);
  const p = pager();
  Object.assign(fx.options, { authorized: false, ancestors: AGENT, page: p.page, teamcity: fakeTeamcity() });
  return { ...fx, pages: p.pages };
};

test('TM-368 autonomy defaults to pr, a nearer layer wins, and an unknown value is rejected rather than widening', async t => {
  const fx = await releaseFixture(t);
  const pluginRoot = fileURLToPath(new URL('../..', import.meta.url));
  const load = () => loadConfig({ consumer: fx.consumer, home: fx.options.home, env: fx.options.env, pluginRoot });
  assert.deepEqual(autonomyOf(await loadConfig({ consumer: fx.consumer, home: fx.options.home, env: fx.options.env })), { level: 'pr', scope: 'built-in', path: null });
  assert.deepEqual(autonomyOf(await load()).level, 'pr', 'the shipped default is pr');
  assert.equal(autonomyOf(await load()).scope, 'defaults');
  const global = join(fx.options.env.XDG_CONFIG_HOME, 'agent-orchestration', 'config.json');
  await writeJson(global, { management: { autonomy: 'publish' } });
  assert.deepEqual(autonomyOf(await load()), { level: 'publish', scope: 'global', path: global });
  await writeJson(global, { management: { autonomy: 'yolo' } });
  const loaded = await load();
  assert.equal(autonomyOf(loaded).level, 'pr');
  assert.match(loaded.errors[0].message, /management\.autonomy" must be one of pr, merge, publish/);
});

test('TM-458 autonomy publish never grants cutover: a managed lead without --authorized is refused and deploys nothing', async t => {
  const fx = await publishFixture(t);
  const error = await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'authority');
  assert.match(error.message, /no autonomy level grants cutover/);
  await nothingRan(fx);
  // A managed session cannot self-assert it either.
  const selfAsserted = await refusedFor(cutover({ ...fx.options, authorized: true }), 'TOPOLOGY_CUTOVER_REFUSED', 'authority');
  assert.match(selfAsserted.message, /cannot be self-asserted/);
  // The operator, from a shell, still can; the record says so.
  const result = await cutover({ ...fx.options, authorized: true, ancestors: OPERATOR });
  assert.equal(result.authorization.channel, 'operator-explicit'); assert.equal(result.authorization.class, 'external');
});

test('TM-458 under autonomy publish a managed lead still cuts a release, and the record names the server grant', async t => {
  const fx = await publishFixture(t);
  const result = await cutRelease(fx.options);
  assert.equal(result.authorization.channel, 'autonomy-policy');
  assert.deepEqual(result.authorization.granted_by, { scope: 'server-default-branch', path: SERVER_SOURCE });
});

test('TM-368 autonomy merge does not grant the External class: a managed lead is still refused', async t => {
  const fx = await publishFixture(t, { policy: { autonomy: 'merge' } });
  const error = await refusedFor(cutover(fx.options), 'TOPOLOGY_CUTOVER_REFUSED', 'authority');
  assert.match(error.message, /autonomy is "merge"/);
  await nothingRan(fx);
});

test('TM-368 green TeamCity: cut-release waits for the build the release started, then verifies, and records it', async t => {
  const fx = await publishFixture(t);
  const result = await cutRelease(fx.options);
  const head = (await fx.git(['rev-parse', 'HEAD'])).stdout.trim();
  assert.deepEqual(fx.options.teamcity.seen, [['latest', TC.build_type], ['wait', TC.build_type, 7, [head]]], 'TM-457: it waits for a build of the release revision');
  assert.deepEqual(result.teamcity, { build_type: TC.build_type, id: 8, number: '1.4.0', status: 'SUCCESS', web_url: 'https://teamcity.invalid/build/8', revision: head, branch: 'develop' });
  assert.deepEqual(await lines(join(fx.logs, 'release-gitflow.sh.log')), ['start', 'verify']);
  assert.deepEqual(fx.pages, []);
});

test('TM-368 red TeamCity build stops the run before verify and pages through ntfy', async t => {
  const fx = await publishFixture(t);
  fx.options.teamcity = fakeTeamcity('FAILURE');
  const error = await cutRelease(fx.options).then(() => null, e => e);
  assert.equal(error?.code, 'TOPOLOGY_RELEASE_BUILD_RED', error?.message);
  assert.match(error.message, /Tests failed: 3/);
  assert.deepEqual(await lines(join(fx.logs, 'release-gitflow.sh.log')), ['start'], 'verify never ran');
  assert.equal(fx.pages.length, 1); assert.match(fx.pages[0].title, /TOPOLOGY_RELEASE_BUILD_RED/); assert.match(fx.pages[0].body, /Tests failed/);
  assert.deepEqual(error.details.paged, { sent: true });
});

test('TM-368 a failed verify (postflight) and a failed cutover postflight each stop and page', async t => {
  const fx = await publishFixture(t, { management: { release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['scripts/fails.sh'], teamcity: TC } } });
  await assert.rejects(cutRelease(fx.options), { code: 'TOPOLOGY_RELEASE_POSTFLIGHT' });
  assert.match(fx.pages[0]?.title ?? '', /TOPOLOGY_RELEASE_POSTFLIGHT/);
  const cut = await publishFixture(t); cut.options.env.POSTFLIGHT_EXIT = '2';
  await assert.rejects(cutover({ ...cut.options, authorized: true, ancestors: OPERATOR }), { code: 'TOPOLOGY_CUTOVER_POSTFLIGHT' }); // TM-458: the operator's cutover
  assert.match(cut.pages[0]?.title ?? '', /TOPOLOGY_CUTOVER_POSTFLIGHT/);
});

test('TM-368 under autonomy publish a release without TeamCity configured or reachable is refused before anything runs', async t => {
  const fx = await publishFixture(t, { management: { release: { branch: 'develop', argv: ['scripts/release-gitflow.sh', 'start'], verify_argv: ['scripts/release-gitflow.sh', 'verify'] } } });
  await refusedFor(cutRelease(fx.options), 'TOPOLOGY_RELEASE_REFUSED', 'teamcity');
  const tokenless = await publishFixture(t); delete tokenless.options.env.TEAMCITY_TOKEN;
  const error = await refusedFor(cutRelease(tokenless.options), 'TOPOLOGY_RELEASE_REFUSED', 'teamcity');
  assert.match(error.message, /TEAMCITY_TOKEN is not set/);
  await nothingRan(fx); await nothingRan(tokenless);
});

test('TM-368 the TeamCity adapter reads builds over REST with the env token as a bearer header, and waits for a newer finished build', async () => {
  assert.match(teamcityTarget({ env: {} }).reason, /TEAMCITY_URL/);
  assert.match(teamcityTarget({ env: { TEAMCITY_URL: 'https://tc.invalid' } }).reason, /TEAMCITY_TOKEN/);
  const target = teamcityTarget({ config: { url: 'https://tc.invalid/' }, env: { TEAMCITY_TOKEN: 'secret' } });
  assert.deepEqual(target, { url: 'https://tc.invalid', token: 'secret' });
  const requests = []; let polls = 0;
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), auth: init.headers.Authorization }); polls++;
    const rev = version => ({ revisions: { revision: [{ version }] } }), REL = 'a'.repeat(40);
    const build = polls < 3 ? [{ id: '7', state: 'finished', status: 'SUCCESS', ...rev(REL) }]
      : polls < 4 ? [{ id: '8', state: 'running', ...rev(REL) }, { id: '7', state: 'finished', status: 'SUCCESS', ...rev(REL) }]
      : [{ id: '8', number: '42', state: 'finished', status: 'FAILURE', ...rev(REL) }, { id: '7', state: 'finished', ...rev(REL) }];
    return { ok: true, json: async () => ({ build }) };
  };
  const client = teamcityClient({ ...target, fetchImpl });
  assert.equal(await client.latestBuildId('Rel'), 7);
  const done = await client.waitForBuild({ buildType: 'Rel', after: 7, revisions: ['a'.repeat(40)], pollMs: 1, timeoutMs: 5000 });
  assert.equal(done.id, 8); assert.equal(done.status, 'FAILURE');
  assert.ok(polls >= 4, 'it kept polling past the running build');
  assert.ok(requests.every(r => r.auth === 'Bearer secret' && r.url.startsWith('https://tc.invalid/app/rest/builds?')));
  assert.match(decodeURIComponent(requests[0].url), /buildType:\(id:Rel\)/);
  const timeout = await teamcityClient({ ...target, fetchImpl: async () => ({ ok: true, json: async () => ({ build: [] }) }) }).waitForBuild({ buildType: 'Rel', after: 7, revisions: ['a'.repeat(40)], pollMs: 1, timeoutMs: 5 });
  assert.equal(timeout.timeout, true);
  await assert.rejects(teamcityClient({ ...target, fetchImpl: async () => ({ ok: false, status: 401 }) }).latestBuildId('Rel'), { code: 'TOPOLOGY_TEAMCITY' });
});

test('TM-457 waitForBuild matches the release revision and branch: a newer green build of another revision or branch never satisfies it', async () => {
  const REL = 'a'.repeat(40), OTHER = 'b'.repeat(40);
  let polls = 0;
  const fetchImpl = async () => {
    polls++;
    const build = [
      { id: '9', state: 'finished', status: 'SUCCESS', branchName: 'develop', revisions: { revision: [{ version: OTHER }] } }, // green, wrong revision
      { id: '10', state: 'finished', status: 'SUCCESS', branchName: 'feature/x', revisions: { revision: [{ version: REL }] } }, // green, wrong branch
      ...(polls >= 3 ? [{ id: '11', number: '7.0', state: 'finished', status: 'FAILURE', branchName: 'release/7.0', revisions: { revision: [{ version: REL }] } }] : []),
    ];
    return { ok: true, json: async () => ({ build }) };
  };
  const client = teamcityClient({ url: 'https://tc.invalid', token: 't', fetchImpl });
  const matched = await client.waitForBuild({ buildType: 'Rel', after: 8, revisions: [REL], branch: 'release/7.0', pollMs: 1, timeoutMs: 5000 });
  assert.equal(matched.id, 11, 'the red build of the release, not an earlier green one of something else');
  assert.equal(matched.status, 'FAILURE'); assert.equal(matched.revision, REL); assert.equal(matched.branchName, 'release/7.0');
  const none = await client.waitForBuild({ buildType: 'Rel', after: 8, revisions: ['c'.repeat(40)], pollMs: 1, timeoutMs: 5 });
  assert.equal(none.timeout, true, 'only other revisions finished: the gate waits and times out rather than passing');
  await assert.rejects(client.waitForBuild({ buildType: 'Rel', after: 8, pollMs: 1, timeoutMs: 5 }), { code: 'TOPOLOGY_TEAMCITY' });
});

test('TM-368 ntfy pages with the env token, falls back to tm variables, and never throws', async () => {
  assert.deepEqual(ntfyTarget({ env: { TM_NTFY_TOPIC: 'tm-topic', TM_NTFY_TOKEN: 'tk' } }), { server: 'https://ntfy.prod.bytedesk.ai', topic: 'tm-topic', token: 'tk' });
  assert.equal((await page({ title: 't', body: 'b', env: {} })).sent, false, 'no topic: reported, not thrown');
  const sent = [];
  const ok = await page({ title: 'stop', body: 'red build', config: { topic: 'ops' }, env: { AO_NTFY_TOKEN: 'secret' }, fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true }; } });
  assert.deepEqual(ok, { sent: true });
  assert.equal(sent[0].url, 'https://ntfy.prod.bytedesk.ai/ops'); assert.equal(sent[0].init.headers.Authorization, 'Bearer secret'); assert.equal(sent[0].init.body, 'red build');
  assert.deepEqual(await page({ title: 't', body: 'b', config: { topic: 'ops' }, env: {}, fetchImpl: async () => { throw new Error('offline'); } }), { sent: false, reason: 'offline' });
});

test('TM-442/TM-458 CLI (formerly test 21, inverted): manage cutover from a managed session under a publish policy is refused and runs nothing', async t => {
  const fx = await releaseFixture(t, { global: { management: { autonomy: 'publish' } } });
  await shimPath(t, fx);
  await mkdir(join(fx.consumer, '.bytedesk/task-management/bin'), { recursive: true });
  const show = 'echo "{\\"id\\":\\"$2\\",\\"status\\":\\"done\\"}"';
  await writeFile(join(fx.consumer, '.bytedesk/task-management/bin/tm'), ['#!/bin/sh', 'case "$1" in',
    `  where) echo '{"store":"${join(fx.root, 'store')}"}' ;;`,
    `  find) echo '[{"id":"TM-1","epic":"EP-1"},{"id":"TM-2","epic":"EP-1"}]' ;;`,
    `  show) ${show} ;;`, '  *) exit 9 ;;', 'esac', ''].join('\n'), { mode: 0o755 });
  const env = { ...fx.options.env, HOME: fx.options.home };
  delete env.TM_DISPATCH_WORKER; delete env.AO_AGENT_ID;
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url)), 'manage', 'cutover', '--epic', 'EP-1', '--consumer', fx.consumer, '--summary'], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr + r.stdout, /TOPOLOGY_CUTOVER_REFUSED/);
  assert.match(r.stderr + r.stdout, /autonomy is "pr"/, 'the global publish did not count (TM-442)');
  assert.match(r.stderr + r.stdout, /no autonomy level grants cutover/, 'and no level would have (TM-458)');
  await nothingRan(fx);
  const gitArgv = await gitSubcommands(join(fx.logs, 'git.argv'));
  assert.ok(gitArgv.length > 0 && gitArgv.includes('fetch')); assert.equal(gitArgv.filter(a => ['push', 'tag'].includes(a)).length, 0, gitArgv.join('\n'));
  // gh is only read (the pinned repository and its committed policy), never asked to change anything.
  assert.ok((await lines(join(fx.logs, 'gh.argv'))).every(line => /^(repo view|api repos\/)/.test(line))); assert.deepEqual(await lines(join(fx.logs, 'systemctl.argv')), []);
});

test('TM-443 config a worker plants in the shared .git/config never runs during release readiness', async t => {
  const fx = await releaseFixture(t);
  const planted = await plantGitVectors(fx.consumer, fx.root);
  const gate = await releaseReadiness(fx.options, 'release');
  assert.ok(gate.revision, 'readiness reached the git checks');
  assert.deepEqual(await planted.fired(), [], 'a planted vector ran as the lead');
});
