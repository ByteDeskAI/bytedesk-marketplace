// EP-028 standing-mail SEND side, driven through the real CLI entries: TM-278 dry run, TM-271
// addressing a repository's lead, TM-356 the sender is the session's identity, TM-372 @all-leads.
//
// No tmux server is touched: the env blanks TMUX and points TMUX_TMPDIR at a scratch dir. Every
// repository opts out of enrollment, so a cross-repository hold can never start a supervisor or a lead.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

// TM-464 (4): hermetic under any host. A session identity inherited from the agent running the
// suite (AO_SESSION_*, AO_AGENT_ID, CLAUDE_CODE_SESSION_ID) would become the in-process adapters'
// identity, and a NATS transport would hold the event loop open after the last test.
for (const key of ['AO_AGENT_ID', 'AO_CONSUMER', 'AO_SESSION_AGENT_ID', 'AO_SESSION_CONSUMER', 'CLAUDE_CODE_SESSION_ID']) delete process.env[key];
process.env.AO_TRANSPORT = 'file';
process.env.AO_NATS_AUTOSTART = '0';
after(async () => { const { closeLiveTransports } = await import('../../topology/lib/orch-transport.mjs'); await closeLiveTransports(); });

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
  // TM-462B: acting as lead-a needs its proven pane, so tests about receiving mail use peer-a.
  const alpha = await repo(root, 'alpha', [['lead-a', 'lead'], ['work-a', 'worker'], ['peer-a', 'worker']]);
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
  const saved = { AO_AGENT_ID: process.env.AO_AGENT_ID, AO_CONSUMER: process.env.AO_CONSUMER, CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID };
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  // The adapter reads the session identity from its own process environment, as the MCP server does.
  const apiAs = (agent, consumer) => {
    if (agent) Object.assign(process.env, { AO_AGENT_ID: agent, AO_CONSUMER: consumer }); else { delete process.env.AO_AGENT_ID; delete process.env.AO_CONSUMER; }
    return createTopologyApi({ stateRoot: w.env.AGENT_ORCHESTRATION_STATE_HOME, pluginRoot: null, resolveConsumer: async (cwd) => ({ requestedCwd: cwd }) });
  };
  const worker = apiAs('work-a', w.alpha);
  const lead = apiAs('peer-a', w.alpha); // the recipient; the real lead needs its pane (below)
  const forgedLead = apiAs('lead-a', w.alpha);
  const anonymous = apiAs(null);
  const mail = { consumerCwd: w.alpha, to: 'peer-a', body: 'via mcp' };
  // TM-462B: naming the repository lead in the env, with no pane, is a claim and is refused.
  await assert.rejects(forgedLead.mailboxSend({ ...mail, id: 'm-forged-lead' }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  await assert.rejects(forgedLead.mailboxReceive({ consumerCwd: w.alpha }), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  await assert.rejects(worker.mailboxSend({ ...mail, id: 'm-spoof', from: 'peer-a' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(worker.mailboxSend({ ...mail, id: 'm-elsewhere', consumerCwd: w.beta }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(anonymous.mailboxSend({ ...mail, id: 'm-anon', from: 'work-a' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  assert.deepEqual(await standingRecords(w.env), [], 'no refused tool call left a record');
  const sent = await worker.mailboxSend({ ...mail, id: 'm-1' });
  assert.deepEqual([sent.status, sent.envelope.from], ['delivered', 'work-a']);
  // Receive and dispose: only the session's own inbox.
  await assert.rejects(worker.mailboxReceive({ consumerCwd: w.alpha, agent: 'peer-a' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(anonymous.mailboxReceive({ consumerCwd: w.alpha, agent: 'peer-a' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  const received = await lead.mailboxReceive({ consumerCwd: w.alpha });
  assert.deepEqual(received.map((record) => record.envelope.id), ['m-1']);
  await assert.rejects(worker.mailboxDispose({ consumerCwd: w.alpha, agent: 'peer-a', messageId: 'm-1', kind: 'mail', disposition: 'handled' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(anonymous.mailboxDispose({ consumerCwd: w.alpha, agent: 'peer-a', messageId: 'm-1', kind: 'mail', disposition: 'handled' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
  await assert.rejects(worker.mailboxDispose({ consumerCwd: w.alpha, messageId: 'm-1', kind: 'mail', disposition: 'handled' }), { code: 'TOPOLOGY_MAILBOX_RECEIPT_MISSING' }, 'the worker disposes only its own receipts, and it holds none for m-1');
  const handled = await lead.mailboxDispose({ consumerCwd: w.alpha, messageId: 'm-1', kind: 'mail', disposition: 'handled' });
  assert.deepEqual([handled.agent, handled.status], ['peer-a', 'handled']);
});

test('TM-372: --to @all-leads fans out to every registered lead, never back to the sender', async (t) => {
  const w = await world(t);
  const sent = await ao(['mailbox', 'send', '--to', '@all-leads', '--id', 'all-1', '--body', 'to every lead'], w.as('work-a', w.alpha));
  assert.equal(sent.code, 0, sent.stderr);
  const byLead = Object.fromEntries(sent.json.sent.map((record) => [record.envelope.to, record]));
  assert.deepEqual(Object.keys(byLead).sort(), ['lead-a', 'lead-b'], 'gamma has no lead, so it is not addressed');
  assert.equal(byLead['lead-a'].status, 'delivered');
  assert.equal(byLead['lead-b'].envelope.consumer, w.beta, 'each lead is addressed in its own repository');
  assert.equal(byLead['lead-b'].reason, 'destination_not_enrolled', 'and admitted on its own: beta opted out');
  assert.deepEqual((await readStandingInbox({ consumer: w.alpha, agent: 'lead-a', env: w.env })).map((record) => record.envelope.body), ['to every lead']);
  // TM-462B: a lead broadcasting must be in its proven pane; an env-only lead claim writes nothing.
  // (The loop guard, that a lead does not mail itself, is asserted on the resolver in the next test.)
  const sentBefore = (await standingRecords(w.env)).length;
  const fromLead = await ao(['send', '--to', '@all-leads', '--body', 'from a lead'], w.as('lead-a', w.alpha));
  assert.deepEqual([fromLead.code, fromLead.json?.code], [1, 'TOPOLOGY_DELEGATION_ACTOR'], fromLead.stdout);
  assert.equal((await standingRecords(w.env)).length, sentBefore);
  // The cap refuses, never truncates, and writes nothing.
  const before = (await standingRecords(w.env)).length;
  const wide = await ao(['mailbox', 'send', '--to', '@all-leads', '--max-recipients', '1', '--body', 'x'], w.as('work-a', w.alpha));
  assert.deepEqual([wide.code, wide.json.code], [1, 'TOPOLOGY_BROADCAST_TOO_WIDE'], wide.stdout);
  assert.equal((await standingRecords(w.env)).length, before);
});

test('TM-372: @all-leads honours the default 24-recipient cap', async (t) => {
  const { MAX_BROADCAST, resolveStandingTargets } = await import('../../topology/lib/addressing.mjs');
  const root = await mkdtemp(join(tmpdir(), 'ao-all-leads-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const lead = async (n) => {
    const dir = join(root, `repo-${n}`);
    await mkdir(dir, { recursive: true });
    const id = (await canonicalRepoId(dir)).id;
    await writeJson(join(leadRegistryDir(env), `${repoKey(id)}.json`), { version: 1, repo_id: id, agent_id: `lead-${n}` });
  };
  for (let n = 1; n <= MAX_BROADCAST; n += 1) await lead(n);
  assert.equal((await resolveStandingTargets({ to: '@all-leads', from: 'someone', env })).length, MAX_BROADCAST, 'exactly the limit is allowed');
  assert.equal((await resolveStandingTargets({ to: '@all-leads', from: 'lead-1', env })).length, MAX_BROADCAST - 1, 'the sender is excluded');
  await lead(MAX_BROADCAST + 1);
  await assert.rejects(resolveStandingTargets({ to: '@all-leads', from: 'someone', env }), { code: 'TOPOLOGY_BROADCAST_TOO_WIDE' });
});

// ---- EP-028 review fixes: TM-462 (part A), TM-463, TM-464, TM-465, TM-466 ----

/** An in-process MCP adapter whose process env holds exactly `vars` as its identity. */
async function mcpAs(w, vars) {
  const { createTopologyApi } = await import('../../src/topology-api.mjs');
  const keys = ['AO_AGENT_ID', 'AO_CONSUMER', 'AO_SESSION_AGENT_ID', 'AO_SESSION_CONSUMER', 'CLAUDE_CODE_SESSION_ID'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, vars);
  try {
    return createTopologyApi({ stateRoot: w.env.AGENT_ORCHESTRATION_STATE_HOME, pluginRoot: null, resolveConsumer: async (cwd) => ({ requestedCwd: cwd }) });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function runIn(w) {
  const dir = join(w.alpha, '.bytedesk', 'agent-orchestration', 'runs', 'r1');
  await writeJson(join(dir, 'run.json'), { consumer: w.alpha, version: 1, name: 't', run_id: 'r1', session: 't-r1', sequence: 0,
    agents: [{ id: 'conductor', role: 'orchestrator' }, { id: 'work-a', role: 'worker' }] });
  return dir;
}

const envelopes = async (run) => JSON.parse(await readFile(join(run, 'run.json'), 'utf8')).message_envelopes ?? {};

test('TM-462: run send checks a named --from/--from-project with the same sessionIdentity as mailbox send', async (t) => {
  const w = await world(t);
  const run = await runIn(w);
  const me = w.as('work-a', w.alpha);
  for (const [args, env, code] of [
    // TM-462B: a host sender is refused by name, from any process, before any other check.
    [['--from', 'ao-supervisor', '--from-project', w.beta], me, 'TOPOLOGY_SENDER_RESERVED'],
    [['--from', 'ao-supervisor'], me, 'TOPOLOGY_SENDER_RESERVED'],
    [[], w.as('ao-supervisor', w.alpha), 'TOPOLOGY_SENDER_RESERVED'],
    [[], w.as('tm-dispatch', w.alpha), 'TOPOLOGY_SENDER_RESERVED'],
    // TM-462B: unnamed, the env is not trusted either: an env-only lead claim needs the lead's pane.
    [[], w.as('lead-a', w.alpha), 'TOPOLOGY_DELEGATION_ACTOR'],
    [['--from-project', w.beta], me, 'TOPOLOGY_SENDER_MISMATCH'],
    [['--from', 'ao-supervisor', '--from-project', w.beta], w.env, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED'],
  ]) {
    const refused = await ao(['send', '--run', run, '--to', 'conductor', ...args, '--body', 'spoof'], env);
    assert.deepEqual([refused.code, refused.json?.code], [1, code], `${args.join(' ')}: ${refused.stdout}${refused.stderr}`);
  }
  assert.deepEqual(await standingRecords(w.env), [], 'no refused send reached the standing mailbox');
  assert.deepEqual(await envelopes(run), {}, 'no refused send wrote a run envelope');
  const sent = await ao(['send', '--run', run, '--to', 'conductor', '--from', 'work-a', '--from-project', w.alpha, '--body', 'mine'], me);
  assert.ok(sent.json?.id, `${sent.stdout}${sent.stderr}`);
  const envelope = (await envelopes(run))[sent.json.id];
  assert.deepEqual([envelope.from, envelope.fromProject], ['work-a', w.alpha]);
});

/** The text of a call's argument list, from `name(` to its matching `)`. */
function callArgs(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return '';
}

test('TM-462/F1: every call that reads or sends standing mail is bound, call site by call site', async () => {
  const { readdir: ls } = await import('node:fs/promises');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = [
    ...(await ls(join(root, 'topology', 'lib'))).filter((f) => f.endsWith('.mjs')).map((f) => join('topology', 'lib', f)),
    join('topology', 'cli.mjs'), join('src', 'topology-api.mjs'),
  ];
  // Readers return bodies; actors send or act as an agent. Each call must carry its binding.
  const READERS = ['listMailboxReceipts', 'listMailboxPublications', 'readStandingInbox', 'readStandingOutbox', 'waitForStandingReply', 'readStandingMessage'];
  // System readers of one record by id, none of which returns the body to a caller-named agent:
  // wait checks the sender itself after the read; the run bridge and the outage notice are internal.
  const INTERNAL_READERS = new Set(['topology/lib/standing-mailbox.mjs#waitForStandingReply', 'topology/lib/mailbox.mjs#obligations',
    'topology/lib/mailbox.mjs#recordReply', 'topology/lib/nats-outage.mjs#natsOutageTick']);
  const ACTORS = ['sendStandingMessage', 'forwardStandingMessage', 'recordStandingReply', 'setMailboxDisposition'];
  // allAgents: true is allowed only here: the operator console (gated by assertOperatorReader) and
  // the publication resume loop (returns no body).
  const OPERATOR_ONLY = new Set(['topology/lib/workflow-control.mjs#workflowMessages', 'topology/lib/mailbox-receipts.mjs#resumeMailboxPublications']);
  // Library actors that send as a SYSTEM sender, not as a caller-named agent: TM-427 governs them.
  const SYSTEM_SENDERS = new Set(['topology/lib/mailbox.mjs', 'topology/lib/slots.mjs', 'topology/lib/standing-mailbox.mjs', 'topology/lib/observer.mjs', 'topology/lib/management.mjs',
    'topology/lib/release.mjs', 'topology/lib/reviewer.mjs', 'topology/lib/goal-loop.mjs', 'topology/lib/goal-loop-notify.mjs', 'topology/lib/review-sweep.mjs',
    'topology/lib/supervision.mjs', 'topology/lib/lead-recovery.mjs', 'topology/lib/roles.mjs', 'topology/cli.mjs#observer']);
  const ENTRY = new Set(['topology/cli.mjs', 'src/topology-api.mjs']);
  const enclosing = (src, at) => [...src.slice(0, at).matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+([\w$]+)|['"]?([\w$-]+)['"]?\s*\(\{[^)\n]*\}\)\s*\{|([\w$]+)\s*\(input\)\s*\{)/g)].map((m) => m[1] || m[2] || m[3]).at(-1);
  const seen = { reader: 0, actor: 0 };
  const problems = [];
  for (const rel of files) {
    const src = await readFile(join(root, rel), 'utf8');
    for (const match of src.matchAll(new RegExp(`\\b(${[...READERS, ...ACTORS].join('|')})\\(`, 'g'))) {
      const at = match.index, name = match[1];
      const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at));
      if (/^\s*(\/\/|\*)/.test(line) || /export async function/.test(line) || /import\(|import \{/.test(line) && !/\)\(/.test(line)) continue;
      const args = callArgs(src, at + name.length);
      const fn = enclosing(src, at);
      const where = `${rel}:${src.slice(0, at).split('\n').length} ${name} in ${fn}`;
      // Before the call, in its enclosing function: where the bound value came from.
      const before = src.slice(Math.max(src.lastIndexOf('\n', at - 1) - 600, 0), at);
      if (READERS.includes(name)) {
        seen.reader += 1;
        if (name === 'readStandingMessage') { if (!INTERNAL_READERS.has(`${rel}#${fn}`)) problems.push(`${where}: readStandingMessage outside its internal readers`); continue; }
        // An operator read names allAgents: true in the call, or in the `query` it builds just before.
        const all = /allAgents:\s*true/.test(args) || args.trim() === 'query' && /const query = \{[^\n]*allAgents:\s*true/.test(before);
        if (all) { if (!OPERATOR_ONLY.has(`${rel}#${fn}`)) problems.push(`${where}: allAgents outside an operator-only path`); continue; }
        if (!/\b(agent|caller)\b/.test(args)) problems.push(`${where}: no bound agent`);
        if (ENTRY.has(rel) && !/const (\{ agent \}|caller) = await (self|me)\(/.test(before)) problems.push(`${where}: entry-point reader not bound by self()/me() (sessionIdentity)`);
      } else {
        seen.actor += 1;
        if (SYSTEM_SENDERS.has(rel) || SYSTEM_SENDERS.has(`${rel}#${fn}`)) continue;
        if (!ENTRY.has(rel)) { problems.push(`${where}: an actor outside the entry points and the system-sender list`); continue; }
        if (!/\b(sender|me|agent)\b/.test(args) && !/\.\.\.input\b/.test(args)) problems.push(`${where}: actor call carries no bound sender`);
        if (!/=\s*await (self|me|api\.sessionIdentity)\(/.test(before) && !/const me = await api\.sessionIdentity\(/.test(src.slice(src.lastIndexOf('async mailbox(', at), at))) problems.push(`${where}: actor not bound by sessionIdentity`);
      }
    }
  }
  // Coverage, so an empty scan cannot pass: the known entry and library call sites were seen.
  assert.ok(seen.reader >= 14 && seen.actor >= 6, `the audit saw the call sites (${JSON.stringify(seen)})`);
  assert.deepEqual(problems, []);
  // me() is sessionIdentity(), and the CLI's send verb names its sender through sessionIdentity().
  const [api, cli] = await Promise.all([readFile(join(root, 'src/topology-api.mjs'), 'utf8'), readFile(join(root, 'topology/cli.mjs'), 'utf8')]);
  assert.match(api.slice(api.indexOf('const me = async'), api.indexOf('const runArgs')), /sessionIdentity\(\{/);
  assert.match(cli.slice(cli.indexOf('  async send({ flags }) {'), cli.indexOf('const fromProject =', cli.indexOf('  async send({ flags }) {'))), /\.sessionIdentity\(\{/);
  // Every MCP mailbox/run-mail tool lands on an adapter method that calls me().
  const mcp = await readFile(join(root, 'src/mcp.mjs'), 'utf8');
  for (const [, tool, method] of mcp.matchAll(/register\(server, topology, '(orchestration_(?:mailbox|run_mail)_\w+)'[\s\S]*?topology\.(\w+)\);/g)) {
    if (tool === 'orchestration_run_mail_wait') continue; // run replies come from the run directory
    const start = api.indexOf(`    async ${method}(input) {`);
    assert.match(api.slice(start, api.indexOf('\n    },\n', start)), /\bme\(/, `${tool} resolves its actor through me()`);
  }
});

test('TM-464 F1: receipt and publication readers fail closed without a bound agent; the console is operator-only', async (t) => {
  const w = await world(t);
  const { listMailboxReceipts, listMailboxPublications } = await import('../../topology/lib/mailbox-receipts.mjs');
  const { workflowDetail } = await import('../../topology/lib/workflow-control.mjs');
  const env = w.env;
  for (const read of [listMailboxReceipts, listMailboxPublications]) {
    await assert.rejects(read({ consumer: w.alpha, env }), { code: 'TOPOLOGY_MAILBOX_SCOPE_REQUIRED' }, `${read.name} with no agent`);
    await assert.rejects(read({ consumer: w.alpha, env, agent: 'lead-a', allAgents: true }), { code: 'TOPOLOGY_MAILBOX_SCOPE_REQUIRED' }, `${read.name} with both`);
    assert.ok(Array.isArray(await read({ consumer: w.alpha, env, agent: 'lead-a' })));
  }
  // Mail in a workflow, then the console as a worker: refused before any body is read.
  assert.equal((await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'c-1', '--body', 'console secret'], w.as('work-a', w.alpha))).json?.status, 'delivered');
  await ao(['mailbox', 'inbox'], w.as('lead-a', w.alpha));
  const show = (extra) => ao(['console', 'show', '--consumer', w.alpha, '--workflow-id', 'topology:none'], { ...env, ...extra });
  for (const extra of [{ TM_DISPATCH_WORKER: '1' }, { AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha }]) {
    const refused = await show(extra);
    assert.deepEqual([refused.code, refused.json?.code], [1, 'TOPOLOGY_OPERATOR_ONLY'], refused.stdout);
    assert.doesNotMatch(refused.stdout, /console secret/);
  }
  await assert.rejects(workflowDetail({ consumer: w.alpha, workflowId: 'topology:none', stateHome: env.AGENT_ORCHESTRATION_STATE_HOME, env: { AO_AGENT_ID: 'work-a' } }), { code: 'TOPOLOGY_OPERATOR_ONLY' });
  // A minted session (no launcher id, no pane) is not the operator either.
  const minted = await show({ AO_SESSION_AGENT_ID: 'abcdef12', AO_SESSION_CONSUMER: w.alpha });
  assert.deepEqual([minted.code, minted.json?.code], [1, 'TOPOLOGY_OPERATOR_ONLY'], minted.stdout);
  // A bare operator shell (no identity, no bound pane) passes the gate and reaches the lookup.
  const bare = await show({});
  assert.deepEqual([bare.code, bare.json?.code], [1, 'TOPOLOGY_WORKFLOW_NOT_FOUND'], bare.stdout);
  // The MCP list tool cannot smuggle allAgents through its input.
  const mcp = await mcpAs(w, { AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha });
  const listed = await mcp.mailboxList({ consumerCwd: w.alpha, allAgents: true });
  assert.ok(listed.receipts.every((receipt) => receipt.agent === 'work-a'), JSON.stringify(listed));
});

test('TM-464: CLI mailbox inbox, outbox, receipts, dispose and reply act only as the session identity', async (t) => {
  const w = await world(t);
  const worker = w.as('work-a', w.alpha);
  const sent = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'peer-a', '--id', 'cli-1', '--body', 'for the lead only'], worker);
  assert.equal(sent.json?.status, 'delivered', sent.stdout);
  for (const [args, env, code] of [
    [['mailbox', 'inbox', '--agent', 'peer-a'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'outbox', '--agent', 'peer-a'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'receipts', '--consumer', w.alpha, '--agent', 'peer-a'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'dispose', '--consumer', w.alpha, '--agent', 'peer-a', '--message', 'cli-1', '--disposition', 'handled'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'reply', '--agent', 'peer-a', '--message', 'cli-1', '--body', 'forged'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'inbox', '--consumer', w.beta], w.as('peer-a', w.alpha), 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'inbox', '--agent', 'peer-a'], w.env, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED'],
    // TM-462B: CLI dispose and inbox go through sessionIdentity, so an env-only lead claim is refused.
    [['mailbox', 'dispose', '--consumer', w.alpha, '--message', 'cli-1', '--disposition', 'handled'], w.as('lead-a', w.alpha), 'TOPOLOGY_DELEGATION_ACTOR'],
    [['mailbox', 'inbox'], w.as('lead-a', w.alpha), 'TOPOLOGY_DELEGATION_ACTOR'],
  ]) {
    const refused = await ao(args, env);
    assert.deepEqual([refused.code, refused.json?.code], [1, code], `${args.join(' ')}: ${refused.stdout}`);
    assert.doesNotMatch(refused.stdout, /for the lead only/);
  }
  // The session's own mailbox needs neither flag: its repository is the identity's, not the cwd.
  const own = await ao(['mailbox', 'inbox'], w.as('peer-a', w.alpha));
  assert.equal(own.code, 0, own.stdout);
  assert.deepEqual(own.json.map((record) => record.envelope.id), ['cli-1']);
});

test('TM-464: run-mail subject and task values can never become CLI flags', async (t) => {
  const w = await world(t);
  const run = await runIn(w);
  const worker = await mcpAs(w, { AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha });
  const sent = await worker.runMailSend({ consumerCwd: w.alpha, runDir: run, to: ['conductor'], body: 'b', subject: `--from-project=${w.beta}`, task: '--from=ao-supervisor' });
  const envelope = (await envelopes(run))[sent.id];
  assert.deepEqual([envelope.subject, envelope.task, envelope.from, envelope.fromProject], [`--from-project=${w.beta}`, '--from=ao-supervisor', 'work-a', w.alpha]);
});

test('TM-465: mailbox wait returns a reply only to the message sender, via CLI and MCP', async (t) => {
  const w = await world(t);
  const worker = w.as('work-a', w.alpha);
  const lead = w.as('peer-a', w.alpha); // the recipient (TM-462B: the real lead needs its pane)
  assert.equal((await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'peer-a', '--id', 'w-1', '--body', 'question'], worker)).json?.status, 'delivered');
  const replied = await ao(['mailbox', 'reply', '--message', 'w-1', '--body', 'secret answer'], lead);
  assert.equal(replied.code, 0, replied.stdout);
  for (const [env, code] of [[lead, 'TOPOLOGY_SENDER_MISMATCH'], [w.as('work-a', w.beta), 'TOPOLOGY_SENDER_MISMATCH'], [w.env, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED']]) {
    const refused = await ao(['mailbox', 'wait', 'w-1', '--timeout', '1s'], env);
    assert.deepEqual([refused.code, refused.json?.code], [1, code], refused.stdout);
    assert.doesNotMatch(refused.stdout, /secret answer/);
  }
  const answered = await ao(['mailbox', 'wait', 'w-1', '--timeout', '1s'], worker);
  assert.deepEqual([answered.code, answered.json?.reply?.body], [0, 'secret answer'], answered.stdout);
  const mcpLead = await mcpAs(w, { AO_AGENT_ID: 'peer-a', AO_CONSUMER: w.alpha });
  const error = await mcpLead.mailboxWait({ consumerCwd: w.alpha, id: 'w-1', timeoutMs: 500 }).then(() => null, (e) => e);
  assert.equal(error?.code, 'TOPOLOGY_SENDER_MISMATCH');
  assert.doesNotMatch(JSON.stringify({ message: error.message, details: error.details }), /secret answer/);
  const mcpWorker = await mcpAs(w, { AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha });
  assert.equal((await mcpWorker.mailboxWait({ consumerCwd: w.alpha, id: 'w-1', timeoutMs: 500 })).reply.body, 'secret answer');
});

test('TM-465 F4: mailbox wait gives one answer for an unknown id and another sender\'s id', async (t) => {
  const w = await world(t);
  assert.equal((await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'peer-a', '--id', 'exists', '--body', 'q'], w.as('work-a', w.alpha))).json?.status, 'delivered');
  const lead = w.as('peer-a', w.alpha);
  const [real, absent] = await Promise.all(['exists', 'never-sent'].map((id) => ao(['mailbox', 'wait', id, '--timeout', '1s'], lead)));
  assert.deepEqual([real.code, real.json?.code], [absent.code, absent.json?.code], `${real.stdout} vs ${absent.stdout}`);
  assert.deepEqual([real.code, real.json?.code], [1, 'TOPOLOGY_SENDER_MISMATCH']);
  assert.equal(real.json.message.replace('exists', 'ID'), absent.json.message.replace('never-sent', 'ID'), 'the messages differ only by the id asked about');
  const mcpLead = await mcpAs(w, { AO_AGENT_ID: 'peer-a', AO_CONSUMER: w.alpha });
  const codes = await Promise.all(['exists', 'never-sent'].map((id) => mcpLead.mailboxWait({ consumerCwd: w.alpha, id, timeoutMs: 200 }).then(() => 'ok', (e) => e.code)));
  assert.deepEqual(codes, ['TOPOLOGY_SENDER_MISMATCH', 'TOPOLOGY_SENDER_MISMATCH']);
});

test('TM-466: an MCP session with no launcher identity acts as its SessionStart-minted identity', async (t) => {
  const w = await world(t);
  const { mintSessionIdentity } = await import('../../topology/lib/session-identity.mjs');
  const minted = await mintSessionIdentity({ sessionId: 'session-466', cwd: w.alpha, env: w.env, home: w.env.HOME, envFile: '' });
  assert.ok(minted.agentId);
  const session = await mcpAs(w, { CLAUDE_CODE_SESSION_ID: 'session-466' });
  const sent = await session.mailboxSend({ consumerCwd: w.alpha, to: 'lead-a', id: 'm-466', body: 'from a plain session' });
  assert.deepEqual([sent.status, sent.envelope.from, sent.envelope.fromProject], ['delivered', minted.agentId, w.alpha]);
  await assert.rejects(session.mailboxSend({ consumerCwd: w.alpha, to: 'lead-a', id: 'm-466b', from: 'lead-a', body: 'x' }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  // A session id with no minted record is still no identity.
  const unknown = await mcpAs(w, { CLAUDE_CODE_SESSION_ID: 'never-started' });
  await assert.rejects(unknown.mailboxSend({ consumerCwd: w.alpha, to: 'lead-a', id: 'm-none', body: 'x' }), { code: 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED' });
});

test('TM-463: session handoff is refused unless the caller is the proven lead or the target agent', async (t) => {
  const w = await world(t);
  const file = join(w.root, 'handoff.md');
  await writeFile(file, '# handoff\n');
  const handoff = (agent, env) => ao(['session', 'handoff', agent, '--file', file, '--consumer', w.alpha], env);
  for (const [agent, env, code] of [
    ['lead-a', w.as('work-a', w.alpha), 'TOPOLOGY_HANDOFF_UNAUTHORIZED'],
    ['work-a', w.env, 'TOPOLOGY_HANDOFF_UNAUTHORIZED'],
    // Naming the lead in the env is not proof: requireLeadCaller wants its live pane and ancestry.
    ['work-a', w.as('lead-a', w.alpha), 'TOPOLOGY_DELEGATION_ACTOR'],
  ]) {
    const refused = await handoff(agent, env);
    assert.deepEqual([refused.code, refused.json?.code], [1, code], refused.stdout);
  }
  // F2: naming the target agent in the env is a claim, not proof: it is refused like the lead claim.
  const self = await handoff('work-a', w.as('work-a', w.alpha));
  assert.deepEqual([self.code, self.json?.code], [1, 'TOPOLOGY_DELEGATION_ACTOR'], self.stdout);
});

test('TM-463 F2: handoff self and lead are proven by pane binding and process ancestry, never by env', async (t) => {
  const w = await world(t);
  const { requireHandoffCaller } = await import('../../topology/lib/respawn.mjs');
  // An injected tmux and /proc, as topology-delegation.test.mjs does: pane %7 runs pid 5151.
  const PANE = { serverKey: '/tmp/ao-fake/default', serverPid: 4242, sessionId: '$1', sessionCreated: 1700000000, paneId: '%7', panePid: 5151 };
  const tree = (leaf) => ({ pid: 903, readStat: async (p) => `${p} (x) S ${{ 903: 902, 902: leaf, [leaf]: 4242, 4242: 1 }[p]} 1 1 0 -1` });
  const proof = (boundTo, leaf = 5151) => ({ listPanesFn: async () => [{ ...PANE, alive: true }],
    readCensusFn: async () => ({ agents: [{ agentId: boundTo, binding: { ...PANE } }] }), callerProc: tree(leaf) });
  const inPane = { TMUX: `${PANE.serverKey},${PANE.serverPid},0`, TMUX_PANE: PANE.paneId };
  const check = (env, p) => requireHandoffCaller({ agentId: 'work-a', consumer: w.alpha, env, home: w.env.HOME, proof: p });
  // Env-only self claim (no pane): refused.
  await assert.rejects(check({ AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha }, proof('work-a')), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // Claims self from a pane bound to work-a, but the caller is not a descendant of that pane: refused.
  await assert.rejects(check({ AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha, ...inPane }, proof('work-a', 6161)), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // Claims self from a pane the census binds to someone else: refused.
  await assert.rejects(check({ AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha, ...inPane }, proof('lead-a')), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // The real own pane: accepted, by env name or by census binding alone.
  assert.deepEqual(await check({ AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha, ...inPane }, proof('work-a')), { caller: 'work-a', as: 'self' });
  assert.deepEqual(await check({ ...inPane }, proof('work-a')), { caller: 'work-a', as: 'self' });
  // The lead in its own proven pane, including an assigned lead with only a minted session id.
  assert.deepEqual(await check({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha, ...inPane }, proof('lead-a')), { caller: 'lead-a', as: 'lead' });
  assert.deepEqual(await check({ AO_SESSION_AGENT_ID: 'abcdef12', AO_SESSION_CONSUMER: w.alpha, ...inPane }, proof('lead-a')), { caller: 'lead-a', as: 'lead' });
  // Any other agent, even in its own proven pane: refused.
  await assert.rejects(check({ AO_AGENT_ID: 'other', AO_CONSUMER: w.alpha, ...inPane }, proof('other')), { code: 'TOPOLOGY_HANDOFF_UNAUTHORIZED' });
});

test('TM-462B: sessionIdentity accepts the lead only from its proven pane, names it from its census binding, and refuses host senders', async (t) => {
  const w = await world(t);
  const { sessionIdentity } = await import('../../topology/lib/standing-mailbox.mjs');
  const PANE = { serverKey: '/tmp/ao-fake/default', serverPid: 4242, sessionId: '$1', sessionCreated: 1700000000, paneId: '%7', panePid: 5151 };
  const tree = (leaf) => ({ pid: 903, readStat: async (p) => `${p} (x) S ${{ 903: 902, 902: leaf, [leaf]: 4242, 4242: 1 }[p]} 1 1 0 -1` });
  const proof = (boundTo, leaf = 5151) => ({ listPanesFn: async () => [{ ...PANE, alive: true }],
    readCensusFn: async () => ({ agents: boundTo ? [{ agentId: boundTo, binding: { ...PANE } }] : [] }), callerProc: tree(leaf) });
  const inPane = { TMUX: `${PANE.serverKey},${PANE.serverPid},0`, TMUX_PANE: PANE.paneId };
  const who = (env, p) => sessionIdentity({ env, home: w.env.HOME, ...p });
  // The proven lead, by env name or (no AO_AGENT_ID) by its census binding, even over a minted id.
  assert.equal((await who({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha, ...inPane }, proof('lead-a'))).agent, 'lead-a');
  assert.equal((await who({ AO_SESSION_AGENT_ID: 'abcdef12', AO_SESSION_CONSUMER: w.alpha, ...inPane }, proof('lead-a'))).agent, 'lead-a');
  // Mutation checks: the lead's pane but not a descendant of it, and the env claim with no pane.
  await assert.rejects(who({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha, ...inPane }, proof('lead-a', 6161)), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  await assert.rejects(who({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha }, proof('lead-a')), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // A non-lead needs no pane; a host sender is refused even from a proven pane.
  assert.equal((await who({ AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha }, proof(null))).agent, 'work-a');
  for (const reserved of ['ao-supervisor', 'ao-management', 'tm-dispatch']) {
    await assert.rejects(who({ AO_AGENT_ID: reserved, AO_CONSUMER: w.alpha, ...inPane }, proof(reserved)), { code: 'TOPOLOGY_SENDER_RESERVED' });
    await assert.rejects(sessionIdentity({ env: { AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha }, agent: reserved, home: w.env.HOME }), { code: 'TOPOLOGY_SENDER_RESERVED' });
  }
});

test('TM-464 F1: the console gate admits only a bare operator shell or the proven lead', async (t) => {
  const w = await world(t);
  const { assertOperatorReader } = await import('../../topology/lib/workflow-control.mjs');
  const PANE = { serverKey: '/tmp/ao-fake/default', serverPid: 4242, sessionId: '$1', sessionCreated: 1700000000, paneId: '%7', panePid: 5151 };
  const tree = (leaf) => ({ pid: 903, readStat: async (p) => `${p} (x) S ${{ 903: 902, 902: leaf, [leaf]: 4242, 4242: 1 }[p]} 1 1 0 -1` });
  const proof = (boundTo, leaf = 5151) => ({ listPanesFn: async () => [{ ...PANE, alive: true }],
    readCensusFn: async () => ({ agents: boundTo ? [{ agentId: boundTo, binding: { ...PANE } }] : [] }), callerProc: tree(leaf) });
  const inPane = { TMUX: `${PANE.serverKey},${PANE.serverPid},0`, TMUX_PANE: PANE.paneId };
  const gate = (env, p) => assertOperatorReader({ consumer: w.alpha, env, home: w.env.HOME, proof: p });
  const refused = { code: 'TOPOLOGY_OPERATOR_ONLY' };
  // Refused: a minted session, in or out of a pane.
  await assert.rejects(gate({ AO_SESSION_AGENT_ID: 'abcdef12', AO_SESSION_CONSUMER: w.alpha }, proof(null)), refused);
  await assert.rejects(gate({ AO_SESSION_AGENT_ID: 'abcdef12', AO_SESSION_CONSUMER: w.alpha, ...inPane }, proof(null)), refused);
  // Refused: a launched agent that unset AO_AGENT_ID but still runs in its bound pane.
  await assert.rejects(gate({ ...inPane }, proof('work-a')), refused);
  // Refused: a non-lead agent in its own proven pane.
  await assert.rejects(gate({ AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha, ...inPane }, proof('work-a')), refused);
  // Refused: naming the lead without its pane is a claim, not proof.
  await assert.rejects(gate({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha }, proof('lead-a')), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // Refused: the lead's pane, but the caller is not a descendant of it.
  await assert.rejects(gate({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha, ...inPane }, proof('lead-a', 6161)), { code: 'TOPOLOGY_DELEGATION_ACTOR' });
  // Allowed: the proven lead, by env name or by its pane binding alone.
  assert.deepEqual(await gate({ AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha, ...inPane }, proof('lead-a')), { as: 'lead', caller: 'lead-a' });
  assert.deepEqual(await gate({ ...inPane }, proof('lead-a')), { as: 'lead', caller: 'lead-a' });
  // Allowed: a bare operator shell, outside tmux or in a pane the census binds to nobody.
  assert.deepEqual(await gate({}, proof(null)), { as: 'operator' });
  assert.deepEqual(await gate({ ...inPane }, proof(null)), { as: 'operator' });
});
