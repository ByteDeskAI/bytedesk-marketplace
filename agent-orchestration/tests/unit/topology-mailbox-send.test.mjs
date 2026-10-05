// EP-028 standing-mail SEND side, driven through the real CLI entries: TM-278 dry run, TM-271
// addressing a repository's lead, TM-356 the sender is the session's identity, TM-372 @all-leads.
//
// No tmux server is touched: the env blanks TMUX and points TMUX_TMPDIR at a scratch dir. Every
// repository opts out of enrollment, so a cross-repository hold can never start a supervisor or a lead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { leadRegistryDir } from '../../topology/lib/lead.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { readServiceRepos, reposPath } from '../../topology/lib/services-client.mjs';
import { readStandingInbox, standingMailboxRoot } from '../../topology/lib/standing-mailbox.mjs';
import { run, writeJson } from '../../topology/lib/util.mjs';

const aoTopology = fileURLToPath(new URL('../../bin/ao-topology', import.meta.url));

async function repo(root, name, agents) {
  const dir = join(root, name);
  await run('git', ['init', '-q', dir]);
  await mkdir(join(dir, '.bytedesk', 'agent-orchestration'), { recursive: true });
  await writeFile(join(dir, '.bytedesk', 'agent-orchestration', 'config.json'), '{"enabled":false}\n');
  for (const [id, role] of agents) await writeJson(join(agentsRoot(dir), id, 'agent.json'), { id, role, full_name: id });
  return dir;
}

/** Register a repository the way services and `lead ensure` do: repos.json, plus a lead record. */
async function register(env, dir, lead) {
  const key = repoKey((await canonicalRepoId(dir)).id);
  const repos = await readServiceRepos(env);
  await writeJson(reposPath(env), { repos: [...repos, { key, consumer: dir }] });
  if (lead) await writeJson(join(leadRegistryDir(env), `${key}.json`), { version: 1, repo_id: (await canonicalRepoId(dir)).id, agent_id: lead, mode: 'dedicated' });
  return key;
}

async function world(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-mailbox-send-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AO_')));
  Object.assign(env, { TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: join(root, 'home'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0', AO_TRANSPORT: 'file' });
  const alpha = await repo(root, 'alpha', [['lead-a', 'lead'], ['work-a', 'worker']]);
  const beta = await repo(root, 'beta', [['lead-b', 'lead']]);
  const gamma = await repo(root, 'gamma', [['lead-g', 'lead']]);
  await register(env, alpha, 'lead-a');
  await register(env, beta, 'lead-b');
  await register(env, gamma, null); // registered, but no lead
  return { root, env, alpha, beta, gamma, as: (agent, consumer) => ({ ...env, AO_AGENT_ID: agent, AO_CONSUMER: consumer }) };
}

function ao(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [aoTopology, ...args, '--json'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out: ${args.join(' ')}`)); }, 60_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(stdout); } catch { /* reported by the caller's assertion */ }
      resolve({ code, json, stdout, stderr });
    });
  });
}

async function standingRecords(env) {
  return readdir(join(standingMailboxRoot({ env }), 'messages')).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
}

test('TM-278: mailbox send --dry-run reports the verdict and writes no envelope', async (t) => {
  const w = await world(t);
  const preview = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'dry-1', '--body', 'hello', '--dry-run'], w.as('work-a', w.alpha));
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.json.dry_run, true);
  assert.equal(preview.json.would, 'deliver');
  assert.equal(preview.json.delivered_to, 'lead-a');
  assert.equal(preview.json.envelope.from, 'work-a');
  assert.ok(preview.json.destination.repo_id, 'the destination repository is named');
  assert.deepEqual(await standingRecords(w.env), [], 'a dry run leaves no record in the standing mailbox');
  assert.deepEqual(await readStandingInbox({ consumer: w.alpha, agent: 'lead-a', env: w.env }), []);

  // A hold is reported with its reason, and still nothing is written.
  const held = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'nobody-here', '--id', 'dry-2', '--body', 'hello', '--dry-run'], w.as('work-a', w.alpha));
  assert.equal(held.code, 0, held.stderr);
  assert.deepEqual([held.json.would, held.json.reason], ['hold', 'unknown_recipient']);
  assert.deepEqual(await standingRecords(w.env), []);

  // The same send without the flag really writes: the check above can see a record when there is one.
  const real = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'dry-1', '--body', 'hello'], w.as('work-a', w.alpha));
  assert.equal(real.json.status, 'delivered', real.stderr);
  assert.equal((await standingRecords(w.env)).length, 1);
});

test('TM-278: every other send verb refuses --dry-run by name and does nothing', async (t) => {
  const w = await world(t);
  for (const args of [
    ['mailbox', 'forward', '--consumer', w.alpha, '--parent', 'x', '--to', 'lead-a', '--body', 'b'],
    ['mailbox', 'reply', '--consumer', w.alpha, '--message', 'x', '--body', 'b'],
    ['mailbox', 'dispose', '--consumer', w.alpha, '--message', 'x', '--disposition', 'handled'],
    ['send', '--run', w.root, '--to', 'lead-a', '--body', 'b'],
    ['reply', '--run', w.root, '--agent', 'lead-a', '--message', 'x', '--body', 'b'],
  ]) {
    const refused = await ao([...args, '--dry-run'], w.as('work-a', w.alpha));
    assert.equal(refused.code, 1, `${args.slice(0, 2).join(' ')}: ${refused.stdout}`);
    assert.equal(refused.json.code, 'TOPOLOGY_DRY_RUN_UNSUPPORTED', `${args.slice(0, 2).join(' ')}: ${refused.stdout}`);
  }
  assert.deepEqual(await standingRecords(w.env), []);
});

test('TM-271: mailbox send and send address a repository lead by slug or path, through one resolver', async (t) => {
  const w = await world(t);
  const me = w.as('work-a', w.alpha);
  // By slug, through `mailbox send`: same repository, so admission delivers to its lead.
  const bySlug = await ao(['mailbox', 'send', '--to-repo', 'alpha', '--id', 'r-1', '--body', 'hi lead'], me);
  assert.equal(bySlug.code, 0, bySlug.stderr);
  assert.deepEqual([bySlug.json.status, bySlug.json.delivered_to, bySlug.json.envelope.to], ['delivered', 'lead-a', 'lead-a']);
  // By `lead@<slug>`, through the run-less `send` entry.
  const viaSend = await ao(['send', '--to', 'lead@alpha', '--id', 'r-2', '--body', 'hi again'], me);
  assert.equal(viaSend.code, 0, viaSend.stderr);
  assert.deepEqual([viaSend.json.status, viaSend.json.delivered_to], ['delivered', 'lead-a']);
  const inbox = await readStandingInbox({ consumer: w.alpha, agent: 'lead-a', env: w.env });
  assert.deepEqual(inbox.map((record) => record.envelope.id).sort(), ['r-1', 'r-2']);
  // By path, to another repository: the envelope names that repository and its registered lead.
  const byPath = await ao(['send', '--to-repo', w.beta, '--id', 'r-3', '--body', 'cross', '--dry-run'], me);
  assert.equal(byPath.code, 0, byPath.stderr);
  assert.equal(byPath.json.envelope.to, 'lead-b');
  assert.equal(byPath.json.destination.lead, 'lead-b');
  assert.equal(byPath.json.envelope.destinationRepoId, (await canonicalRepoId(w.beta)).id);
});

test('TM-271: an unknown repository or one with no lead is refused and nothing is written', async (t) => {
  const w = await world(t);
  for (const [args, code] of [
    [['mailbox', 'send', '--to-repo', 'no-such-repo'], 'TOPOLOGY_REPO_UNKNOWN'],
    [['send', '--to', 'lead@no-such-repo'], 'TOPOLOGY_REPO_UNKNOWN'],
    [['mailbox', 'send', '--to-repo', join(w.root, 'missing')], 'TOPOLOGY_REPO_UNKNOWN'],
    [['mailbox', 'send', '--to-repo', 'gamma'], 'TOPOLOGY_REPO_NO_LEAD'],
    [['send', '--to-repo', w.gamma], 'TOPOLOGY_REPO_NO_LEAD'],
  ]) {
    const refused = await ao([...args, '--body', 'x'], w.as('work-a', w.alpha));
    assert.equal(refused.code, 1, `${args.join(' ')}: ${refused.stdout}`);
    assert.equal(refused.json.code, code, `${args.join(' ')}: ${refused.stdout}`);
  }
  assert.deepEqual(await standingRecords(w.env), [], 'nothing was delivered or held');
});

test('TM-356: mailbox send and forward take the sender from the session; a spoofed --from is refused', async (t) => {
  const w = await world(t);
  const me = w.as('work-a', w.alpha);
  for (const [args, env, code] of [
    [['mailbox', 'send', '--consumer', w.alpha, '--from', 'lead-a', '--to', 'lead-a'], me, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'send', '--consumer', w.alpha, '--from-project', w.beta, '--to', 'lead-a'], me, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'forward', '--consumer', w.alpha, '--from', 'lead-a', '--parent', 'p', '--to', 'lead-a'], me, 'TOPOLOGY_SENDER_MISMATCH'],
    [['send', '--to-repo', 'alpha', '--from', 'lead-a'], me, 'TOPOLOGY_SENDER_MISMATCH'],
    // No session identity at all: a flag cannot supply one.
    [['mailbox', 'send', '--consumer', w.alpha, '--from', 'work-a', '--from-project', w.alpha, '--to', 'lead-a'], w.env, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED'],
  ]) {
    const refused = await ao([...args, '--body', 'spoof'], env);
    assert.equal(refused.code, 1, `${args.join(' ')}: ${refused.stdout}`);
    assert.equal(refused.json.code, code, `${args.join(' ')}: ${refused.stdout}`);
  }
  assert.deepEqual(await standingRecords(w.env), [], 'no refused send left a record');
  // Repeating the session's own identity is allowed, and the envelope carries it.
  const sent = await ao(['mailbox', 'send', '--consumer', w.alpha, '--from', 'work-a', '--to', 'lead-a', '--id', 'own', '--body', 'mine'], me);
  assert.equal(sent.code, 0, sent.stderr);
  assert.deepEqual([sent.json.status, sent.json.envelope.from, sent.json.envelope.fromProject], ['delivered', 'work-a', w.alpha]);
});

test('TM-356: MCP mailbox send, receive and dispose act only as the session identity', async (t) => {
  const w = await world(t);
  const { createTopologyApi } = await import('../../src/topology-api.mjs');
  const saved = { AO_AGENT_ID: process.env.AO_AGENT_ID, AO_CONSUMER: process.env.AO_CONSUMER };
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  // The adapter reads the session identity from its own process environment, as the MCP server does.
  const apiAs = (agent, consumer) => {
    if (agent) Object.assign(process.env, { AO_AGENT_ID: agent, AO_CONSUMER: consumer }); else { delete process.env.AO_AGENT_ID; delete process.env.AO_CONSUMER; }
    return createTopologyApi({ stateRoot: w.env.AGENT_ORCHESTRATION_STATE_HOME, pluginRoot: null, resolveConsumer: async (cwd) => ({ requestedCwd: cwd }) });
  };
  const worker = apiAs('work-a', w.alpha);
  const lead = apiAs('lead-a', w.alpha);
  const anonymous = apiAs(null);
  const mail = { consumerCwd: w.alpha, to: 'lead-a', body: 'via mcp' };
  await assert.rejects(worker.mailboxSend({ ...mail, id: 'm-spoof', from: 'lead-a' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(worker.mailboxSend({ ...mail, id: 'm-elsewhere', consumerCwd: w.beta }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(anonymous.mailboxSend({ ...mail, id: 'm-anon', from: 'work-a' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  assert.deepEqual(await standingRecords(w.env), [], 'no refused tool call left a record');
  const sent = await worker.mailboxSend({ ...mail, id: 'm-1' });
  assert.deepEqual([sent.status, sent.envelope.from], ['delivered', 'work-a']);
  // Receive and dispose: only the session's own inbox.
  await assert.rejects(worker.mailboxReceive({ consumerCwd: w.alpha, agent: 'lead-a' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(anonymous.mailboxReceive({ consumerCwd: w.alpha, agent: 'lead-a' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  const received = await lead.mailboxReceive({ consumerCwd: w.alpha });
  assert.deepEqual(received.map((record) => record.envelope.id), ['m-1']);
  await assert.rejects(worker.mailboxDispose({ consumerCwd: w.alpha, agent: 'lead-a', messageId: 'm-1', kind: 'mail', disposition: 'handled' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(anonymous.mailboxDispose({ consumerCwd: w.alpha, agent: 'lead-a', messageId: 'm-1', kind: 'mail', disposition: 'handled' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  await assert.rejects(worker.mailboxDispose({ consumerCwd: w.alpha, messageId: 'm-1', kind: 'mail', disposition: 'handled' }), { code: 'TOPOLOGY_MAILBOX_RECEIPT_MISSING' }, 'the worker disposes only its own receipts, and it holds none for m-1');
  const handled = await lead.mailboxDispose({ consumerCwd: w.alpha, messageId: 'm-1', kind: 'mail', disposition: 'handled' });
  assert.deepEqual([handled.agent, handled.status], ['lead-a', 'handled']);
});
