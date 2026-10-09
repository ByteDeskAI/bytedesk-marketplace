// TM-243: operator-installed allow rules for the lead's governed verbs. No real tmux, process tree
// or network: ancestors, pane listing and census are injected; the CLI is only spawned for refusals
// that happen before it touches anything.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BASE_RULES, installPermissions, uninstallPermissions, permissionRules, ruleMatches } from '../../topology/lib/permissions.mjs';
import { bindingAgentId } from '../../topology/lib/delegation.mjs';
import { run } from '../../topology/lib/util.mjs';

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const operator = async () => ['zsh', 'tmux: server'];
// Lines a diff marks with `sign`, minus JSON's trailing comma (moving the last array item changes it).
const marked = (diff, sign) => diff.split('\n').filter(l => l.startsWith(`${sign} `)).map(l => l.slice(2).trim().replace(/,$/, ''));

async function fixture(t, { launchCwd } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ao-permissions-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'); await mkdir(consumer); await run('git', ['init', '-q', consumer]);
  const agentDir = join(consumer, '.bytedesk', 'agent-orchestration', 'agents', 'lead-1');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'agent.json'), JSON.stringify({ id: 'lead-1', full_name: 'Lead One', role: 'lead' }));
  await writeFile(join(agentDir, 'session.json'), JSON.stringify({ agent_id: 'lead-1', cwd: launchCwd === undefined ? agentDir : launchCwd === null ? consumer : launchCwd }));
  const env = { USER: 'ryan', AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const settings = join(agentDir, '.claude', 'settings.local.json');
  return { root, consumer, agentDir, settings, env, opts: { consumer, env, home: join(root, 'home'), ancestors: operator } };
}

test('install is operator-only: agent markers, an agent ancestor or a registered agent pane are refused and nothing is written', async t => {
  const { opts, settings, env, root } = await fixture(t);
  for (const marker of ['AO_AGENT_ID', 'TM_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX'])
    await assert.rejects(installPermissions({ ...opts, env: { ...env, [marker]: '1' } }), { code: 'TOPOLOGY_PERMISSIONS_OPERATOR_ONLY', message: new RegExp(marker) });
  await assert.rejects(installPermissions({ ...opts, ancestors: async () => ['bash', 'claude'] }), { code: 'TOPOLOGY_PERMISSIONS_OPERATOR_ONLY', message: /agent process is an ancestor/ });
  await assert.rejects(uninstallPermissions({ ...opts, ancestors: async () => ['zsh', 'codex-acp'] }), { code: 'TOPOLOGY_PERMISSIONS_OPERATOR_ONLY' });
  const censusDir = join(root, 'state', 'census'); await mkdir(censusDir, { recursive: true });
  await writeFile(join(censusDir, 'x.json'), JSON.stringify({ agents: [{ agentId: 'lead-1', binding: { paneId: '%9', serverKey: '/tmp/fake/default' } }] }));
  await assert.rejects(installPermissions({ ...opts, env: { ...env, TMUX: '/tmp/fake/default,1,0', TMUX_PANE: '%9' } }), { code: 'TOPOLOGY_PERMISSIONS_OPERATOR_ONLY', message: /registered to agent lead-1/ });
  await assert.rejects(readFile(settings), { code: 'ENOENT' }, 'a refused install writes nothing');
});

test('the CLI refuses install inside a managed session before reading anything', async t => {
  const { consumer } = await fixture(t);
  const cli = spawnSync(process.execPath, [join(PLUGIN, 'topology', 'cli.mjs'), 'permissions', 'install', '--consumer', consumer],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDECODE: '1' } });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /TOPOLOGY_PERMISSIONS_OPERATOR_ONLY/);
});

test('install writes exactly the approved rules plus opted-in MCP servers, prints the diff, preserves other keys and is idempotent', async t => {
  const { opts, settings } = await fixture(t);
  await mkdir(dirname(settings), { recursive: true });
  const original = { model: 'opus', permissions: { allow: ['Bash(ls *)'], deny: ['Bash(rm -rf *)'], defaultMode: 'auto' }, env: { FOO: '1' } };
  await writeFile(settings, JSON.stringify(original, null, 2));
  const first = await installPermissions({ ...opts, mcp: ['mcp__plugin_teamcity-mcp_teamcity'] });
  assert.deepEqual(BASE_RULES, ['Bash(ao-topology manage record-landing *)', 'Bash(ao-topology manage integrate *)', 'Bash(ao-topology manage start-worker *)',
    'Bash(ao-topology manage stop-worker *)', 'Bash(ao-topology manage admit *)', 'Bash(ao-topology manage report *)', 'Bash(ao-topology manage retry-review *)', 'Bash(ao-topology manage close *)', 'Bash(tm *)']);
  assert.equal(first.path, settings); assert.equal(first.changed, true); assert.match(first.restart, /Restart the lead/);
  assert.deepEqual(first.added, [...BASE_RULES, 'mcp__plugin_teamcity-mcp_teamcity']);
  for (const rule of first.added) assert.match(first.diff, new RegExp(`^\\+ +"${rule.replace(/[()*]/g, '\\$&')}",?$`, 'm'));
  for (const line of marked(first.diff, '-')) assert.ok(marked(first.diff, '+').includes(line), `install removes nothing: ${line}`);
  const after = JSON.parse(await readFile(settings, 'utf8'));
  assert.deepEqual(after, { ...original, permissions: { ...original.permissions, allow: ['Bash(ls *)', ...first.added] } });
  assert.ok(!after.permissions.allow.some(r => /gh pr merge|git push|deploy/.test(r)), 'never raw merge, push or deploy');
  const bytes = await readFile(settings, 'utf8');
  const second = await installPermissions({ ...opts, mcp: ['mcp__plugin_teamcity-mcp_teamcity'] });
  assert.equal(second.changed, false); assert.deepEqual(second.added, []); assert.equal(second.diff, '(no change)');
  assert.equal(await readFile(settings, 'utf8'), bytes, 'a repeated install leaves the file byte-identical');
  await assert.rejects(installPermissions({ ...opts, mcp: ['mcp__teamcity__*'] }), { code: 'TOPOLOGY_PERMISSIONS_MCP' });
  await assert.rejects(installPermissions({ ...opts, mcp: ['Bash(git push *)'] }), { code: 'TOPOLOGY_PERMISSIONS_MCP' });
});

test('uninstall removes exactly the rules install added and nothing else', async t => {
  const { opts, settings } = await fixture(t);
  await mkdir(dirname(settings), { recursive: true });
  // The operator already had Bash(tm *) before install: install does not add it, so uninstall must keep it.
  const original = { permissions: { allow: ['Bash(tm *)', 'Bash(ls *)'], ask: ['Bash(git push *)'] }, hooks: { Stop: [] } };
  await writeFile(settings, JSON.stringify(original, null, 2));
  const installed = await installPermissions({ ...opts, mcp: ['mcp__x'] });
  assert.ok(!installed.added.includes('Bash(tm *)'));
  const removed = await uninstallPermissions(opts);
  assert.deepEqual(removed.removed, installed.added);
  assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), original, 'every other key and pre-existing rule survives');
  for (const line of marked(removed.diff, '+')) assert.ok(marked(removed.diff, '-').includes(line), `uninstall adds nothing: ${line}`);
  assert.deepEqual(marked(removed.diff, '-').filter(l => !marked(removed.diff, '+').includes(l)), installed.added.map(r => JSON.stringify(r)));
  const again = await uninstallPermissions(opts);
  assert.equal(again.changed, false, 'a second uninstall is a no-op');
  // A dry run reports the diff and writes nothing.
  const dry = await installPermissions({ ...opts, dryRun: true });
  assert.equal(dry.changed, true); assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), original);
});

test('install targets the lead\'s own launch directory and refuses a shared one (TM-242) or an unknown one', async t => {
  const shared = await fixture(t, { launchCwd: null });
  await assert.rejects(installPermissions(shared.opts), { code: 'TOPOLOGY_PERMISSIONS_TARGET_SHARED', message: /not its own agent directory/ });
  const unknown = await fixture(t);
  await rm(join(unknown.agentDir, 'session.json'));
  await assert.rejects(installPermissions(unknown.opts), { code: 'TOPOLOGY_PERMISSIONS_LEAD', message: /lead ensure/ });
});

// Criterion 2: bare commands resolve the caller from the pane binding, and the command text a lead
// runs has no env-var prefix and matches an installed rule.
const PANE = { serverKey: '/tmp/ao-fake/default', serverPid: 4242, sessionId: '$1', sessionCreated: 1700000000, paneId: '%7', panePid: 5151 };
test('a bare governed command names its caller from the census binding of its live pane', async t => {
  const { consumer, env } = await fixture(t);
  const lookups = { listPanesFn: async () => [{ ...PANE, alive: true }], readCensusFn: async () => ({ agents: [{ agentId: 'lead-1', binding: { ...PANE } }] }) };
  const paneEnv = { ...env, TMUX: `${PANE.serverKey},${PANE.serverPid},0`, TMUX_PANE: PANE.paneId };
  assert.equal(await bindingAgentId({ consumer, env: paneEnv, ...lookups }), 'lead-1');
  assert.equal(await bindingAgentId({ consumer, env, ...lookups }), null, 'no pane, no caller');
  assert.equal(await bindingAgentId({ consumer, env: { ...paneEnv, TMUX_PANE: '%8' }, ...lookups }), null, 'a pane the census does not bind names nobody');
  assert.equal(await bindingAgentId({ consumer, env: paneEnv, ...lookups, readCensusFn: async () => ({ agents: [{ agentId: 'lead-1', binding: { ...PANE, panePid: 9999 } }] }) }), null, 'another incarnation of the pane names nobody');
});

test('every documented lead command is bare and matches an installed rule; prefixed and piped forms do not', async () => {
  const doc = await readFile(join(PLUGIN, 'docs', 'repository-leads.md'), 'utf8');
  const block = doc.split('<!-- lead-commands')[1].match(/```bash\n([\s\S]*?)```/)[1];
  const commands = block.trim().split('\n');
  assert.ok(commands.length >= 7, `found ${commands.length} documented commands`);
  const rules = permissionRules([]);
  for (const verb of ['admit', 'start-worker', 'report', 'stop-worker', 'integrate', 'record-landing'])
    assert.ok(commands.some(c => c.startsWith(`ao-topology manage ${verb} `)), `documents ${verb}`);
  for (const command of commands) {
    assert.doesNotMatch(command, /^\s*[A-Za-z_][A-Za-z0-9_]*=/, `no env-var prefix: ${command}`);
    assert.ok(rules.some(rule => ruleMatches(rule, command)), `a rule matches: ${command}`);
  }
  const landing = commands.find(c => c.includes('record-landing'));
  assert.equal(rules.some(r => ruleMatches(r, `AO_AGENT_ID=lead-1 ${landing}`)), false, 'an env prefix defeats every rule');
  assert.equal(rules.some(r => ruleMatches(r, `${landing.replace(' --summary', '')} | jq .merge`)), false, 'a pipe defeats every rule');
  assert.equal(rules.some(r => ruleMatches(r, 'ao-topology manage cleanup --task TM-1')), false, 'cleanup is not in the approved list');
  assert.equal(rules.some(r => ruleMatches(r, 'gh pr merge 130')), false);
});

test('the CLI refuses a dispatched worker every lead verb but lets its report through the guard', async t => {
  const { consumer } = await fixture(t);
  const cli = args => spawnSync(process.execPath, [join(PLUGIN, 'topology', 'cli.mjs'), 'manage', ...args, '--consumer', consumer, '--task', 'TM-1'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, TM_DISPATCH_WORKER: '1', AGENT_ORCHESTRATION_STATE_HOME: join(consumer, '..', 'state') } });
  for (const verb of ['admit', 'start-worker', 'stop-worker', 'rework', 'integrate', 'record-landing', 'bind', 'cleanup', 'assign', 'release']) {
    const r = cli([verb]); assert.equal(r.status, 1, verb); assert.match(r.stderr, /TOPOLOGY_MANAGEMENT_WORKER_REFUSED/, verb);
  }
  const report = cli(['report']);
  assert.doesNotMatch(report.stderr, /WORKER_REFUSED/, 'report is the worker\'s own verb');
});
