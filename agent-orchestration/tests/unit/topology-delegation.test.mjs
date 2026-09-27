import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grantDelegation as rawGrant, listStandingDelegations, revokeDelegation as rawRevoke, findActiveDelegation, DELEGATION_SCOPES, GRANT_NOTE, planDigest } from '../../topology/lib/delegation.mjs';

// An interactive operator, with no agent process above it, who retypes exactly what the prompt asks for.
// epicTasks stands in for the task store at grant time; EP-19 holds TM-248 and TM-9 then.
const operatorIo = { ancestors: async () => ['zsh', 'tmux: server'], isTTY: () => true, ask: async q => q.match(/Type "([^"]+)"/)[1], epicTasks: async epic => (epic === 'EP-19' ? ['TM-248', 'TM-9'] : []) };
// TM-248: every grant names an approved plan and an expiry; the default here is epic EP-19 for 7 days.
const PLAN = { plan: { epic: 'EP-19' }, expires: '7d' };
const grantDelegation = opts => rawGrant({ io: operatorIo, ...PLAN, ...opts });
const IN_PLAN = { id: 'TM-248', epic: 'EP-19' };
const revokeDelegation = opts => rawRevoke({ io: operatorIo, ...opts });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-delegation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'); await mkdir(consumer, { recursive: true });
  const home = join(root, 'home');
  const operatorEnv = { USER: 'ryan' };
  const agentEnv = { USER: 'ryan', AO_AGENT_ID: 'lead-1' };
  for (const id of ['lead-1', 'lead-2', 'someone-else']) {
    await mkdir(join(consumer, '.bytedesk', 'agent-orchestration', 'agents', id), { recursive: true });
    await writeFile(join(consumer, '.bytedesk', 'agent-orchestration', 'agents', id, 'agent.json'), JSON.stringify({ id, full_name: id, role: 'member' }));
  }
  return { consumer, home, operatorEnv, agentEnv };
}

// An injected /proc: pid -> [comm, ppid]. The lead: node under claude under the pane's shell (5151).
const LEAD_TREE = { 903: ['node', 902], 902: ['claude', 5151], 5151: ['zsh', 4242], 4242: ['tmux: server', 1] };
// A worker on the same tmux server, in its own pane (6161), with no path to the lead's pane process.
const WORKER_TREE = { 703: ['node', 702], 702: ['claude', 6161], 6161: ['zsh', 4242], 4242: ['tmux: server', 1] };
const procTree = (tree, pid = Math.max(...Object.keys(tree).map(Number))) => ({ pid, readStat: async p => {
  if (!tree[p]) throw Object.assign(new Error(`no /proc/${p}`), { code: 'ENOENT' });
  return `${p} (${tree[p][0]}) S ${tree[p][1]} 1 1 0 -1`;
} });

// A caller whose live pane the census binds to `bindTo`: the injected lookups stand in for tmux.
const PANE = { serverKey: '/tmp/ao-fake/default', serverPid: 4242, sessionId: '$1', sessionCreated: 1700000000, paneId: '%7', panePid: 5151 };
const inPane = (bindTo, pane = PANE) => ({
  env: { USER: 'ryan', AO_AGENT_ID: 'lead-1', TMUX: `${pane.serverKey},${pane.serverPid},0`, TMUX_PANE: pane.paneId },
  listPanesFn: async () => [{ ...pane, alive: true }],
  readCensusFn: async () => ({ agents: [{ agentId: bindTo, binding: { ...pane } }] }),
  callerProc: procTree(LEAD_TREE),
});

test('grant requires --to and only accepts scopes from the fixed allowlist', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: '', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_GRANTEE' });
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: [] }), { code: 'TOPOLOGY_DELEGATION_SCOPE' });
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: 'not-an-agent', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_GRANTEE', message: /names no agent registered/ });
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['deploy'] }), { code: 'TOPOLOGY_DELEGATION_SCOPE' });
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate', 'push'] }), { code: 'TOPOLOGY_DELEGATION_SCOPE' });
  assert.deepEqual(DELEGATION_SCOPES, ['integrate', 'record-landing']);
});

test('grant refuses a self-grant and refuses any managed agent session, even granting to someone else', async t => {
  const { consumer, home, agentEnv } = await fixture(t);
  await assert.rejects(grantDelegation({ consumer, home, env: { ...agentEnv, AO_AGENT_ID: 'lead-1' }, to: 'lead-1', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_SELF' });
  await assert.rejects(grantDelegation({ consumer, home, env: agentEnv, to: 'someone-else', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY' });
});

test('an operator grant is append-only, listed and readable straight off disk', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate', 'record-landing'], reason: 'lead needs to close its own landings' });
  assert.equal(grant.grantor, 'ryan'); assert.equal(grant.grantee, 'lead-1');
  assert.deepEqual(grant.scopes, ['integrate', 'record-landing']); assert.deepEqual(grant.plan, { epic: 'EP-19', tasks: ['TM-248', 'TM-9'], sha256: planDigest(['TM-248', 'TM-9']) });
  assert.ok(Date.parse(grant.expires_at) > Date.now() + 6 * 86_400_000 && Date.parse(grant.expires_at) <= Date.now() + 7 * 86_400_000);
  assert.ok(grant.id && grant.created_at);
  const listed = await listStandingDelegations({ consumer, home, env: operatorEnv });
  assert.equal(listed.length, 1); assert.deepEqual({ ...listed[0], revoked_at: undefined, revoked_by: undefined }, { ...grant, revoked_at: undefined, revoked_by: undefined });
  assert.equal(listed[0].revoked_at, null);
});

test('revoke marks status without mutating the original grant event on disk, and cannot be repeated', async t => {
  const { consumer, home, operatorEnv, agentEnv } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] });
  await assert.rejects(revokeDelegation({ consumer, home, env: operatorEnv, id: 'not-a-real-id' }), { code: 'TOPOLOGY_DELEGATION_UNKNOWN' });
  await assert.rejects(revokeDelegation({ consumer, home, env: agentEnv, id: grant.id }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY' });
  const revoked = await revokeDelegation({ consumer, home, env: operatorEnv, id: grant.id });
  assert.deepEqual(revoked, { revoked: true, id: grant.id });
  await assert.rejects(revokeDelegation({ consumer, home, env: operatorEnv, id: grant.id }), { code: 'TOPOLOGY_DELEGATION_REVOKED' });
  const listed = await listStandingDelegations({ consumer, home, env: operatorEnv });
  assert.equal(listed[0].revoked_at !== null, true); assert.equal(listed[0].revoked_by, 'ryan');
  // The file holds two events, not one mutated record: the grant line is byte-identical to what was written.
  const file = JSON.parse(await readFile(join(home, '.local', 'state', 'bytedesk', 'agent-orchestration', 'delegations', `${await repoKeyOf(consumer, home, operatorEnv)}.json`), 'utf8'));
  assert.equal(file.length, 2); assert.deepEqual(file[0], grant); assert.equal(file[1].type, 'revoke');
});

async function repoKeyOf(consumer, home, env) {
  const { canonicalRepoId, repoKey } = await import('../../topology/lib/repoid.mjs');
  return repoKey((await canonicalRepoId(consumer)).id);
}

test('findActiveDelegation matches only the exact grantee, repository and scope, live and unexpired', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const other = join(consumer, '..', 'other-repo');
  await mkdir(other, { recursive: true });
  await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] });
  await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-2', scopes: ['record-landing'], expires: '1h' });
  assert.equal(await findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }) !== null, true);
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'record-landing', task: IN_PLAN }), null, 'grant does not cover an unlisted scope');
  assert.equal(await findActiveDelegation({ consumer, home, ...inPane('lead-2'), agentId: 'lead-2', scope: 'record-landing', task: IN_PLAN }) !== null, true);
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-2', scope: 'record-landing', task: IN_PLAN, now: Date.now() + 2 * 3600_000 }), null, 'expired grant no longer stands in for authorization');
  assert.equal(await findActiveDelegation({ consumer: other, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), null, 'a grant scoped to one repository never authorizes another');
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'unknown-agent', scope: 'integrate', task: IN_PLAN }), null);
  const grant = (await listStandingDelegations({ consumer, home, env: operatorEnv }))[0];
  await revokeDelegation({ consumer, home, env: operatorEnv, id: grant.id });
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), null, 'a revoked grant authorizes nothing');
});

const delegationsDir = home => join(home, '.local', 'state', 'bytedesk', 'agent-orchestration', 'delegations');

test('grant refuses every agent-session marker, not only AO_AGENT_ID', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  for (const marker of ['TM_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX']) {
    await assert.rejects(grantDelegation({ consumer, home, env: { ...operatorEnv, [marker]: '1' }, to: 'lead-1', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', message: new RegExp(marker) });
  }
});

test('grant refuses a caller sitting in a tmux pane the census binds to an agent', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const censusDir = join(home, '.local', 'state', 'bytedesk', 'agent-orchestration', 'census');
  await mkdir(censusDir, { recursive: true });
  await writeFile(join(censusDir, 'abc.json'), JSON.stringify({ agents: [{ agentId: 'lead-1', binding: { paneId: '%9', serverKey: '/tmp/tmux-1000/default' } }] }));
  const env = { ...operatorEnv, TMUX: '/tmp/tmux-1000/default,1,0' };
  await assert.rejects(grantDelegation({ consumer, home, env: { ...env, TMUX_PANE: '%9' }, to: 'lead-2', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', message: /registered to agent lead-1/ });
  const grant = await grantDelegation({ consumer, home, env: { ...env, TMUX_PANE: '%10' }, to: 'lead-2', scopes: ['integrate'] });
  assert.equal(grant.channel.tmux_pane, '%10');
});

test('grant requires an interactive terminal and an exact typed confirmation', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  await assert.rejects(rawGrant({ ...PLAN, consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, isTTY: () => false, ask: async () => 'lead-1 integrate EP-19' } }), { code: 'TOPOLOGY_DELEGATION_TTY' });
  await assert.rejects(rawGrant({ ...PLAN, consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, ask: async () => 'y' } }), { code: 'TOPOLOGY_DELEGATION_CONFIRM' });
  await assert.rejects(rawGrant({ ...PLAN, consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, ask: async () => 'lead-1 integrate' } }), { code: 'TOPOLOGY_DELEGATION_CONFIRM' }, 'the plan must be retyped too');
  assert.deepEqual(await listStandingDelegations({ consumer, home, env: operatorEnv }), [], 'a refused grant writes nothing');
});

test('grant and revoke refuse when a Claude Code or Codex process is an ancestor, even with a clean env', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  for (const chain of [['bash', 'claude'], ['sh', 'node /usr/lib/node_modules/@openai/codex/bin/codex.js'], ['zsh', 'codex-acp']]) {
    await assert.rejects(rawGrant({ ...PLAN, consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, ancestors: async () => chain } }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', message: /agent process is an ancestor/ });
  }
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] });
  await assert.rejects(rawRevoke({ consumer, home, env: operatorEnv, id: grant.id, io: { ancestors: async () => ['claude'] } }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY' });
});

test('a grant records its channel evidence and is labelled plainly as not agent-proof', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate', 'record-landing'] });
  assert.equal(grant.channel.kind, 'interactive-same-user');
  assert.equal(grant.channel.stdin_tty, true); assert.equal(grant.channel.stdout_tty, true);
  assert.equal(grant.channel.no_agent_ancestor, true);
  assert.equal(grant.channel.confirmation, 'lead-1 integrate,record-landing EP-19');
  assert.ok(grant.channel.agent_markers_checked.includes('AO_AGENT_ID') && grant.channel.agent_markers_checked.includes('CLAUDE_CODE_*'));
  assert.equal(grant.channel.agent_proof, false);
  assert.equal(grant.channel.note, GRANT_NOTE); assert.match(grant.channel.note, /Not agent-proof/); assert.match(grant.channel.note, /tmux or `script`/);
  assert.equal('mac' in grant, false, 'no signature that would look like proof');
});

test('a delegations file holding a grant without channel evidence is refused outright', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] });
  const file = join(delegationsDir(home), `${await repoKeyOf(consumer, home, operatorEnv)}.json`);
  const original = await readFile(file, 'utf8');
  const { channel, ...bare } = grant;
  await writeFile(file, JSON.stringify([...JSON.parse(original), { ...bare, id: 'hand-written', grantee: 'lead-2' }]));
  await assert.rejects(findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-2', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_INTEGRITY' });
  await assert.rejects(findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_INTEGRITY' }, 'one bad grant poisons the file, not just itself');
  await writeFile(file, original);
  assert.equal((await findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN })).id, grant.id);
});

test('a matching grant counts only for a caller whose live pane the census binds to the grantee', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] });
  // A worker naming the lead from outside tmux, or from its own pane, is refused, not silently ignored.
  await assert.rejects(findActiveDelegation({ consumer, home, env: { USER: 'ryan', AO_AGENT_ID: 'lead-1' }, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /live tmux pane/ });
  await assert.rejects(findActiveDelegation({ consumer, home, ...inPane('worker-7'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /bound to agent worker-7/ });
  await assert.rejects(findActiveDelegation({ consumer, home, ...inPane('lead-1'), readCensusFn: async () => null, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /no agent/ });
  // The lead's pane recorded in the census, but a different incarnation now holds that pane id: refused.
  const reborn = inPane('lead-1'); reborn.listPanesFn = async () => [{ ...PANE, panePid: 9999, alive: true }];
  await assert.rejects(findActiveDelegation({ consumer, home, ...reborn, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // A dead pane is not an incarnation.
  const dead = inPane('lead-1'); dead.listPanesFn = async () => [{ ...PANE, alive: false }];
  await assert.rejects(findActiveDelegation({ consumer, home, ...dead, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  assert.equal((await findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN })).id, grant.id);
  // No grant for this caller: nothing to prove, plain null (a worker's own id is never refused for lacking a grant).
  assert.equal(await findActiveDelegation({ consumer, home, env: { USER: 'ryan' }, agentId: 'worker-7', scope: 'integrate', task: IN_PLAN }), null);
});

test('callerRunsInPane walks the injected parent chain and stops at 64 hops', async () => {
  const { callerRunsInPane } = await import('../../topology/lib/slots.mjs');
  assert.equal(await callerRunsInPane({ panePid: 5151 }, procTree(LEAD_TREE)), true);
  assert.equal(await callerRunsInPane({ panePid: 5151 }, procTree(WORKER_TREE)), false);
  const loop = { 10: ['a', 11], 11: ['b', 10] };
  assert.equal(await callerRunsInPane({ panePid: 5151 }, procTree(loop, 10)), false, 'a cycle terminates');
  await assert.rejects(callerRunsInPane({ panePid: 5151 }, { pid: 903, readStat: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } }), { code: 'EACCES' });
});

test('THE ATTACK: env naming the lead\'s pane is refused unless the lead\'s pane process is an ancestor', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] });
  // Worker keeps TMUX, sets TMUX_PANE=%7 and AO_AGENT_ID=lead-1; its ancestry never reaches 5151.
  const attack = { ...inPane('lead-1'), callerProc: procTree(WORKER_TREE) };
  await assert.rejects(findActiveDelegation({ consumer, home, ...attack, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /not an ancestor/ });
  // /proc unreadable (non-Linux, hardened mount): fail closed, never trust the env vars.
  const blind = { ...inPane('lead-1'), callerProc: { pid: 903, readStat: async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); } } };
  await assert.rejects(findActiveDelegation({ consumer, home, ...blind, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /unreadable/ });
  // TMUX_PANE's live pane_pid differs from the census binding: refused before ancestry is consulted.
  const swapped = { ...inPane('lead-1'), listPanesFn: async () => [{ ...PANE, panePid: 6161, alive: true }], callerProc: procTree(WORKER_TREE) };
  await assert.rejects(findActiveDelegation({ consumer, home, ...swapped, agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_ACTOR', message: /pane_pid 6161/ });
  // The genuine lead: node -> claude -> the pane's shell 5151. Accepted.
  assert.equal((await findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN })).id, grant.id);
});

// TM-248: an approved plan is a grant scoped to an epic or task list, a repo, a lead and an expiry.
test('a plan grant requires a plan and an expiry of at most 14 days', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  const base = { consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'] };
  await assert.rejects(grantDelegation({ ...base, plan: undefined }), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  await assert.rejects(grantDelegation({ ...base, plan: { epic: '', tasks: [] } }), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  await assert.rejects(grantDelegation({ ...base, plan: { epic: 'nineteen' } }), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  await assert.rejects(grantDelegation({ ...base, plan: { tasks: ['TM-1', 'x'] } }), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  await assert.rejects(grantDelegation({ ...base, expires: undefined }), { code: 'TOPOLOGY_DELEGATION_EXPIRY' });
  await assert.rejects(grantDelegation({ ...base, expires: '15d' }), { code: 'TOPOLOGY_DELEGATION_EXPIRY' });
  assert.deepEqual(await listStandingDelegations({ consumer, home, env: operatorEnv }), [], 'a refused grant writes nothing');
  const grant = await grantDelegation({ ...base, plan: { tasks: 'TM-1, TM-2' }, expires: '14d' });
  assert.deepEqual(grant.plan, { epic: null, tasks: ['TM-1', 'TM-2'], sha256: planDigest(['TM-1', 'TM-2']) });
  assert.equal(grant.channel.confirmation, 'lead-1 integrate TM-1,TM-2');
});

test('findActiveDelegation covers only the task ids the grant froze; the task\'s current epic is never read', async t => {
  const { consumer, home } = await fixture(t);
  const byEpic = await grantDelegation({ consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'] });
  const find = task => findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task });
  assert.equal((await find({ id: 'TM-9', epic: 'EP-20' })).id, byEpic.id, 'a frozen member moved out of the epic is still covered');
  await assert.rejects(find({ id: 'TM-10', epic: 'EP-19' }), { code: 'TOPOLOGY_DELEGATION_PLAN', message: /covers TM-10;.*EP-19 \(TM-248,TM-9\)/ });
  await assert.rejects(find(null), { code: 'TOPOLOGY_DELEGATION_PLAN' }, 'coverage that cannot be checked is refused');
  const byList = await grantDelegation({ consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'], plan: { tasks: ['TM-77'] } });
  assert.equal((await find({ id: 'TM-77', epic: 'EP-99' })).id, byList.id, 'a listed task is covered whatever its epic');
});

test('an epic grant freezes the store\'s task list at grant time and shows it in the confirmation', async t => {
  const { consumer, home } = await fixture(t);
  const store = { 'EP-19': ['TM-2', 'TM-1'] };
  let prompt = '';
  const io = { ...operatorIo, epicTasks: async epic => [...(store[epic] || [])], ask: async q => { prompt = q; return q.match(/Type "([^"]+)"/)[1]; } };
  const grant = await rawGrant({ ...PLAN, consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'], plan: { epic: 'EP-19', tasks: ['TM-5'] }, io });
  assert.deepEqual(grant.plan, { epic: 'EP-19', tasks: ['TM-1', 'TM-2', 'TM-5'], sha256: planDigest(['TM-1', 'TM-2', 'TM-5']) });
  assert.match(prompt, /exactly these 3 task\(s\), frozen now: TM-1, TM-2, TM-5/); assert.match(prompt, /needs a new grant/);
  assert.equal(grant.channel.confirmation, 'lead-1 integrate EP-19,TM-5');
  store['EP-19'].push('TM-3'); // created in the epic after the grant
  const find = id => findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: { id, epic: 'EP-19' } });
  await assert.rejects(find('TM-3'), { code: 'TOPOLOGY_DELEGATION_PLAN' });
  assert.equal((await find('TM-2')).id, grant.id);
  await assert.rejects(rawGrant({ ...PLAN, consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'], plan: { epic: 'EP-7' }, io }), { code: 'TOPOLOGY_DELEGATION_PLAN', message: /no tasks under EP-7/ });
});

test('a tampered plan.tasks or plan.sha256 poisons the delegations file (TOPOLOGY_DELEGATION_INTEGRITY)', async t => {
  const { consumer, home } = await fixture(t);
  await grantDelegation({ consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'] });
  const file = join(delegationsDir(home), `${await repoKeyOf(consumer, home, {})}.json`);
  const [grant] = JSON.parse(await readFile(file, 'utf8'));
  for (const plan of [{ ...grant.plan, tasks: [...grant.plan.tasks, 'TM-10'] }, { ...grant.plan, sha256: planDigest(['TM-10']) }]) {
    await writeFile(file, JSON.stringify([{ ...grant, plan }]));
    await assert.rejects(findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: { id: 'TM-10' } }), { code: 'TOPOLOGY_DELEGATION_INTEGRITY', message: /plan\.sha256/ });
  }
});

test('an epic grant written before the list was frozen (no plan.sha256) covers nothing and asks for a re-grant', async t => {
  const { consumer, home } = await fixture(t);
  await grantDelegation({ consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'] });
  const file = join(delegationsDir(home), `${await repoKeyOf(consumer, home, {})}.json`);
  const [grant] = JSON.parse(await readFile(file, 'utf8'));
  // Both shapes e357d4d wrote: an epic alone, and an epic with a task list.
  for (const plan of [{ epic: 'EP-19', tasks: [] }, { epic: 'EP-19', tasks: ['TM-248'] }]) {
    await writeFile(file, JSON.stringify([{ ...grant, plan }]));
    await assert.rejects(findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_PLAN', message: /without a frozen task list.*re-grant/ });
  }
});

test('a grant without a plan (written before TM-248) covers no task', async t => {
  const { consumer, home } = await fixture(t);
  const grant = await grantDelegation({ consumer, home, env: { USER: 'ryan' }, to: 'lead-1', scopes: ['integrate'] });
  const file = join(delegationsDir(home), `${await repoKeyOf(consumer, home, {})}.json`);
  const [{ plan, ...legacy }] = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify([legacy]));
  await assert.rejects(findActiveDelegation({ consumer, home, ...inPane('lead-1'), agentId: 'lead-1', scope: 'integrate', task: IN_PLAN }), { code: 'TOPOLOGY_DELEGATION_PLAN', message: /none/ });
  assert.ok(grant.id);
});

test('managedSessionEvidence names every marker, including TM_DISPATCH_WORKER, and an agent ancestor', async () => {
  const { managedSessionEvidence } = await import('../../topology/lib/delegation.mjs');
  const shell = async () => ['zsh', 'tmux: server'];
  assert.deepEqual(await managedSessionEvidence({ env: { USER: 'ryan' }, ancestors: shell }), []);
  for (const marker of ['AO_AGENT_ID', 'TM_SESSION_ID', 'TM_DISPATCH_WORKER', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX'])
    assert.match((await managedSessionEvidence({ env: { [marker]: '1' }, ancestors: shell })).join(), new RegExp(marker));
  assert.match((await managedSessionEvidence({ env: {}, ancestors: async () => ['bash', '/home/u/.local/share/claude/versions/2.1.280'] })).join(), /agent process is an ancestor/);
});
