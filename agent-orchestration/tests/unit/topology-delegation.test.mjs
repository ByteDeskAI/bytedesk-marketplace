import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grantDelegation, listStandingDelegations, revokeDelegation, findActiveDelegation, DELEGATION_SCOPES } from '../../topology/lib/delegation.mjs';

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
