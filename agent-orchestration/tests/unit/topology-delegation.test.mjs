import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grantDelegation as rawGrant, listStandingDelegations, revokeDelegation as rawRevoke, findActiveDelegation, DELEGATION_SCOPES, GRANT_NOTE } from '../../topology/lib/delegation.mjs';

// An interactive operator, with no agent process above it, who retypes exactly what the prompt asks for.
const operatorIo = { ancestors: async () => ['zsh', 'tmux: server'], isTTY: () => true, ask: async q => q.match(/Type "([^"]+)"/)[1] };
const grantDelegation = opts => rawGrant({ io: operatorIo, ...opts });
const revokeDelegation = opts => rawRevoke({ io: operatorIo, ...opts });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-delegation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'); await mkdir(consumer, { recursive: true });
  const home = join(root, 'home');
  const operatorEnv = { USER: 'ryan' };
  const agentEnv = { USER: 'ryan', AO_AGENT_ID: 'lead-1' };
  return { consumer, home, operatorEnv, agentEnv };
}

test('grant requires --to and only accepts scopes from the fixed allowlist', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: '', scopes: ['integrate'] }), { code: 'TOPOLOGY_DELEGATION_GRANTEE' });
  await assert.rejects(grantDelegation({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: [] }), { code: 'TOPOLOGY_DELEGATION_SCOPE' });
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
  assert.deepEqual(grant.scopes, ['integrate', 'record-landing']); assert.equal(grant.expires_at, null);
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
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate' }) !== null, true);
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'record-landing' }), null, 'grant does not cover an unlisted scope');
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-2', scope: 'record-landing' }) !== null, true);
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-2', scope: 'record-landing', now: Date.now() + 2 * 3600_000 }), null, 'expired grant no longer stands in for authorization');
  assert.equal(await findActiveDelegation({ consumer: other, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate' }), null, 'a grant scoped to one repository never authorizes another');
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'unknown-agent', scope: 'integrate' }), null);
  const grant = (await listStandingDelegations({ consumer, home, env: operatorEnv }))[0];
  await revokeDelegation({ consumer, home, env: operatorEnv, id: grant.id });
  assert.equal(await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate' }), null, 'a revoked grant authorizes nothing');
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
  await assert.rejects(rawGrant({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, isTTY: () => false, ask: async () => 'lead-1 integrate' } }), { code: 'TOPOLOGY_DELEGATION_TTY' });
  await assert.rejects(rawGrant({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, ask: async () => 'y' } }), { code: 'TOPOLOGY_DELEGATION_CONFIRM' });
  await assert.rejects(rawGrant({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, ask: async () => 'lead-1 integrate,record-landing' } }), { code: 'TOPOLOGY_DELEGATION_CONFIRM' });
  assert.deepEqual(await listStandingDelegations({ consumer, home, env: operatorEnv }), [], 'a refused grant writes nothing');
});

test('grant and revoke refuse when a Claude Code or Codex process is an ancestor, even with a clean env', async t => {
  const { consumer, home, operatorEnv } = await fixture(t);
  for (const chain of [['bash', 'claude'], ['sh', 'node /usr/lib/node_modules/@openai/codex/bin/codex.js'], ['zsh', 'codex-acp']]) {
    await assert.rejects(rawGrant({ consumer, home, env: operatorEnv, to: 'lead-1', scopes: ['integrate'], io: { ...operatorIo, ancestors: async () => chain } }), { code: 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', message: /agent process is an ancestor/ });
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
  assert.equal(grant.channel.confirmation, 'lead-1 integrate,record-landing');
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
  await assert.rejects(findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-2', scope: 'integrate' }), { code: 'TOPOLOGY_DELEGATION_INTEGRITY' });
  await assert.rejects(findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate' }), { code: 'TOPOLOGY_DELEGATION_INTEGRITY' }, 'one bad grant poisons the file, not just itself');
  await writeFile(file, original);
  assert.equal((await findActiveDelegation({ consumer, home, env: operatorEnv, agentId: 'lead-1', scope: 'integrate' })).id, grant.id);
});
