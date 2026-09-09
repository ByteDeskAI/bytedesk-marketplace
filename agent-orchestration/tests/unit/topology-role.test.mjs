import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { createAgent } from '../../topology/lib/agents.mjs';
import { titleForRole } from '../../topology/lib/identity.mjs';
import { roleAssign, roleDetach, roleHistory, roleList, roleReassign, roleShow, roleStatus } from '../../topology/lib/roles.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-role-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  await mkdir(consumer);
  await run('git', ['init', '-q', consumer]);
  await run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base']);
  await writeJson(join(pluginRoot, 'config.defaults.json'), {
    lead: { template: 'l' },
    reviewer: { template: 'r' },
    templates: {
      l: { role: 'lead', cli: 'claude', instructions: 'Lead this repository.' },
      r: { role: 'reviewer', cli: 'codex', instructions: 'Review independently.' },
    },
    management: { reviewer_providers: ['codex', 'claude'] },
  });
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  return { consumer, pluginRoot, home, env };
}

const mint = (f, role, name) => createAgent(f.consumer, { role, full_name: name }, null, { home: f.home, pluginRoot: f.pluginRoot, env: f.env });

test('the singleton rule binds lead and reviewer and nothing else', async t => {
  const f = await fixture(t);
  const kills = [];
  const a = await mint(f, 'worker', 'Ada One'), b = await mint(f, 'worker', 'Bell Two');
  const probes = { alive: async () => true, responsive: async () => true, pane: async () => '%1', open: async () => ({ session: 'ao-x', pane: '%1' }), kill: async r => kills.push(r) };
  const o = { ...f, probes };

  const first = await roleAssign({ ...o, role: 'lead', agentRef: a.id });
  assert.equal(first.record.agent_id, a.id);
  // A second identity is refused while the first record stands...
  await assert.rejects(roleAssign({ ...o, role: 'lead', agentRef: b.id }), { code: 'TOPOLOGY_LEAD_ALREADY_ASSIGNED' });
  // ...and still refused after detaching the record, because the library still names one lead.
  await roleDetach({ ...o, role: 'lead' });
  await assert.rejects(roleAssign({ ...o, role: 'lead', agentRef: b.id }), { code: 'TOPOLOGY_MULTIPLE_LEADS' });
  assert.equal(kills.length, 0);

  // designer is not a singleton: two holders, and role show returns a LIST.
  const d1 = await mint(f, 'worker', 'Cleo Three'), d2 = await mint(f, 'worker', 'Dara Four');
  await roleAssign({ ...o, role: 'designer', agentRef: d1.id });
  await roleAssign({ ...o, role: 'designer', agentRef: d2.id });
  const shown = await roleShow({ ...f, role: 'designer' });
  assert.equal(shown.singleton, false);
  assert.deepEqual(shown.holders.map(h => h.id).sort(), [d1.id, d2.id].sort());
  assert.equal((await roleShow({ ...f, role: 'lead' })).singleton, true);
});

test('reviewer assignment refuses the lead and refuses an author', async t => {
  const f = await fixture(t);
  const probes = { alive: async () => true, responsive: async () => true, open: async () => ({ session: 'ao-r', pane: '%1' }) };
  const lead = await mint(f, 'lead', 'Emil Five'), author = await mint(f, 'worker', 'Fern Six');
  await assert.rejects(roleAssign({ ...f, probes, role: 'reviewer', agentRef: lead.id }), { code: 'TOPOLOGY_REVIEWER_CONFLICT' });
  await assert.rejects(roleAssign({ ...f, probes, role: 'reviewer', agentRef: author.id, notAgentIds: [author.id] }), { code: 'TOPOLOGY_REVIEWER_CONFLICT' });
  const ok = await roleAssign({ ...f, probes, role: 'reviewer', agentRef: author.id });
  assert.equal(ok.record.agent_id, author.id);
  assert.equal(ok.privileges, 'unchanged');
});

test('role status keeps registered, alive and responsive as three separate fields', async t => {
  const f = await fixture(t);
  let alive = true, responsive = true;
  const probes = { alive: async () => alive, responsive: async () => responsive, pane: async () => '%1', open: async () => ({ session: 'ao-l', pane: '%1' }), kill: () => assert.fail('must not kill') };
  const o = { ...f, probes, role: 'lead' };

  const none = await roleStatus(o);
  assert.deepEqual([none.state, none.registered, none.alive, none.responsive], ['none', false, false, false]);

  const agent = await mint(f, 'worker', 'Goro Seven');
  await roleAssign({ ...o, agentRef: agent.id });
  const live = await roleStatus(o);
  assert.deepEqual([live.state, live.registered, live.alive, live.responsive], ['responsive', true, true, true]);

  responsive = false;
  const unresponsive = await roleStatus(o);
  assert.deepEqual([unresponsive.state, unresponsive.registered, unresponsive.alive, unresponsive.responsive], ['unresponsive', true, true, false]);

  alive = false;
  const registered = await roleStatus(o);
  assert.deepEqual([registered.state, registered.registered, registered.alive, registered.responsive], ['registered', true, false, false]);
  assert.equal(registered.holder, agent.id);
});

test('reassign hands the role over without killing, duplicating, or changing privileges', async t => {
  const f = await fixture(t);
  const kills = [];
  const outgoing = await mint(f, 'worker', 'Hana Eight'), incoming = await mint(f, 'worker', 'Ilya Nine');
  let responsiveFor = new Set([outgoing.id, incoming.id]);
  const probes = {
    alive: async () => true,
    responsive: async record => responsiveFor.has(record.agent_id),
    pane: async () => '%1',
    open: async () => ({ session: 'ao-l', pane: '%1' }),
    kill: async r => { kills.push(r); },
  };
  const o = { ...f, probes, role: 'lead' };
  await roleAssign({ ...o, agentRef: outgoing.id });

  const handed = await roleReassign({ ...o, agentRef: incoming.id });
  assert.equal(handed.from, outgoing.id);
  assert.equal(handed.to, incoming.id);
  assert.equal(handed.privileges, 'unchanged');
  assert.equal(handed.incumbent.session_killed, false);
  assert.deepEqual(handed.preserved.outgoing, { conversation: true, task: 'kept', cwd: 'kept', session: 'running', library_role: 'worker' });
  assert.deepEqual(handed.preserved.incoming, { conversation: true, task: 'kept', cwd: 'kept' });
  assert.equal(kills.length, 0, 'a handoff never kills the outgoing session');
  // Both sides were told, and the successor is the sole holder.
  assert.equal(handed.notified.length, 2);
  assert.deepEqual(handed.notified.map(n => n.to).sort(), [incoming.id, outgoing.id].sort());
  assert.deepEqual(handed.notified.map(n => n.status), ['delivered', 'delivered'], 'both sides are actually told, not silently dropped');
  assert.ok(handed.outstanding.standing_unanswered.every(m => typeof m.id === 'string'));
  const after = await roleList(f);
  assert.deepEqual(after.roles.find(r => r.role === 'lead').holders.map(h => h.id), [incoming.id]);

  // An unresponsive incumbent is REPORTED, not assumed dead — and --force still neither kills nor duplicates.
  responsiveFor = new Set([outgoing.id]);
  await assert.rejects(roleReassign({ ...o, agentRef: outgoing.id }), error => {
    assert.equal(error.code, 'TOPOLOGY_ROLE_INCUMBENT_UNRESPONSIVE');
    assert.deepEqual([error.details.registered, error.details.alive, error.details.responsive], [true, true, false]);
    return true;
  });
  const forced = await roleReassign({ ...o, agentRef: outgoing.id, force: true });
  assert.equal(forced.forced, true);
  assert.equal(forced.incumbent.responsive, false);
  assert.equal(kills.length, 0);
  const final = await roleList(f);
  assert.deepEqual(final.roles.find(r => r.role === 'lead').holders.map(h => h.id), [outgoing.id]);
  const leads = (await roleShow({ ...f, role: 'lead' }));
  assert.equal(leads.holder.id, outgoing.id);
});

test('history logs one entry per transition, in order, and reads back', async t => {
  const f = await fixture(t);
  const probes = { alive: async () => true, responsive: async () => true, pane: async () => '%1', open: async () => ({ session: 'ao-l', pane: '%1' }), kill: () => assert.fail('must not kill') };
  const o = { ...f, probes, role: 'lead' };
  const a = await mint(f, 'worker', 'Juno Ten'), b = await mint(f, 'worker', 'Kiran Eleven');
  await roleAssign({ ...o, agentRef: a.id });
  await roleReassign({ ...o, agentRef: b.id });
  await roleDetach({ ...o });
  const history = await roleHistory({ ...f, role: 'lead' });
  assert.deepEqual(history.entries.map(e => e.verb), ['assign', 'reassign', 'detach']);
  assert.deepEqual(history.entries.map(e => [e.from, e.to]), [[null, a.id], [a.id, b.id], [b.id, null]]);
  assert.ok(history.entries.every(e => typeof e.at === 'string' && e.role === 'lead'));
  assert.ok(history.path.endsWith('lead.history.jsonl'));
});

test('role list names an image-gen holder with its title from TITLES', async t => {
  const f = await fixture(t);
  const artist = await mint(f, 'image-gen', 'Lior Twelve');
  const listed = await roleList(f);
  const row = listed.roles.find(r => r.role === 'image-gen');
  assert.equal(row.singleton, false);
  assert.deepEqual(row.holders, [{ id: artist.id, name: `Lior Twelve, ${titleForRole('image-gen')}`, title: 'Image Generation Engineer' }]);
  assert.deepEqual(listed.roles.map(r => r.role), ['lead', 'reviewer', 'worker', 'designer', 'image-gen']);
  assert.deepEqual(listed.roles.filter(r => r.singleton).map(r => r.role), ['lead', 'reviewer']);
});
