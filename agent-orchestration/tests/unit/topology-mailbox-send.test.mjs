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
  const saved = { AO_AGENT_ID: process.env.AO_AGENT_ID, AO_CONSUMER: process.env.AO_CONSUMER, CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID };
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
  // The loop guard: a lead broadcasting does not mail itself. Through the run-less `send` entry.
  const fromLead = await ao(['send', '--to', '@all-leads', '--body', 'from a lead'], w.as('lead-a', w.alpha));
  assert.equal(fromLead.code, 0, fromLead.stderr);
  assert.deepEqual(fromLead.json.sent.map((record) => record.envelope.to), ['lead-b']);
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
    [['--from', 'ao-supervisor', '--from-project', w.beta], me, 'TOPOLOGY_SENDER_MISMATCH'],
    [['--from', 'ao-supervisor'], me, 'TOPOLOGY_SENDER_MISMATCH'],
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

test('TM-462: every standing-mail entry point resolves its actor through the one sessionIdentity check', async () => {
  const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const [cli, api, mcp] = await Promise.all([read('../../topology/cli.mjs'), read('../../src/topology-api.mjs'), read('../../src/mcp.mjs')]);
  const mailCall = /\b(sendStandingMessage|forwardStandingMessage|recordStandingReply|readStandingInbox|readStandingOutbox|waitForStandingReply|setMailboxDisposition|listMailboxReceipts)\(/;
  // CLI: find the `commands` verb enclosing every standing-mail call.
  const verbs = [...cli.matchAll(/^ {2}(?:async )?['"]?([\w-]+)['"]?\(\{[^)]*\}\) \{$/gm)].map((m) => ({ name: m[1], start: m.index }));
  const bodyOf = (start) => cli.slice(start, cli.indexOf('\n  },\n', start));
  const callers = new Set();
  let offset = 0;
  for (const line of cli.split('\n')) {
    if (mailCall.test(line) && !/^\s*(\/\/|\*)/.test(line)) callers.add(verbs.filter((verb) => verb.start <= offset).at(-1)?.name);
    offset += line.length + 1;
  }
  assert.ok(callers.has('mailbox'), 'the audit found the mailbox verb (it can see a call site)');
  // `observer report` sends as the observer service itself: a system sender, which TM-427 governs.
  callers.delete('observer');
  assert.deepEqual([...callers].sort(), ['mailbox'], 'only `mailbox` touches standing mail directly in the CLI');
  for (const name of ['mailbox', 'send']) {
    const verb = verbs.find((entry) => entry.name === name);
    assert.ok(verb, `CLI verb ${name} exists`);
    assert.match(bodyOf(verb.start), /\bsessionIdentity\(\{/, `CLI ${name} resolves its sender with sessionIdentity()`);
  }
  // MCP: every mailbox and run-mail tool is an adapter method that goes through me(), and me() is sessionIdentity().
  const tools = [...mcp.matchAll(/register\(server, topology, '(orchestration_(?:mailbox|run_mail)_\w+)'[\s\S]*?topology\.(\w+)\);/g)];
  assert.ok(tools.length >= 8, `found the mail tools (${tools.length})`);
  const methodBody = (name) => {
    const start = api.indexOf(`    async ${name}(input) {`);
    assert.ok(start >= 0, `adapter method ${name} exists`);
    return api.slice(start, api.indexOf('\n    },\n', start));
  };
  for (const [, tool, method] of tools) {
    if (tool === 'orchestration_run_mail_wait') continue; // run replies come from the run directory, not standing mail
    assert.match(methodBody(method), /\bme\(/, `${tool} (${method}) resolves its actor through me()`);
  }
  assert.match(api.slice(api.indexOf('const me = async'), api.indexOf('const runArgs')), /sessionIdentity\(\{/, 'me() is sessionIdentity()');
});

test('TM-464: CLI mailbox inbox, outbox, receipts, dispose and reply act only as the session identity', async (t) => {
  const w = await world(t);
  const worker = w.as('work-a', w.alpha);
  const sent = await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'cli-1', '--body', 'for the lead only'], worker);
  assert.equal(sent.json?.status, 'delivered', sent.stdout);
  for (const [args, env, code] of [
    [['mailbox', 'inbox', '--agent', 'lead-a'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'outbox', '--agent', 'lead-a'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'receipts', '--consumer', w.alpha, '--agent', 'lead-a'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'dispose', '--consumer', w.alpha, '--agent', 'lead-a', '--message', 'cli-1', '--disposition', 'handled'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'reply', '--agent', 'lead-a', '--message', 'cli-1', '--body', 'forged'], worker, 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'inbox', '--consumer', w.beta], w.as('lead-a', w.alpha), 'TOPOLOGY_SENDER_MISMATCH'],
    [['mailbox', 'inbox', '--agent', 'lead-a'], w.env, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED'],
  ]) {
    const refused = await ao(args, env);
    assert.deepEqual([refused.code, refused.json?.code], [1, code], `${args.join(' ')}: ${refused.stdout}`);
    assert.doesNotMatch(refused.stdout, /for the lead only/);
  }
  // The session's own mailbox needs neither flag: its repository is the identity's, not the cwd.
  const own = await ao(['mailbox', 'inbox'], w.as('lead-a', w.alpha));
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
  const lead = w.as('lead-a', w.alpha);
  assert.equal((await ao(['mailbox', 'send', '--consumer', w.alpha, '--to', 'lead-a', '--id', 'w-1', '--body', 'question'], worker)).json?.status, 'delivered');
  const replied = await ao(['mailbox', 'reply', '--message', 'w-1', '--body', 'secret answer'], lead);
  assert.equal(replied.code, 0, replied.stdout);
  for (const [env, code] of [[lead, 'TOPOLOGY_SENDER_MISMATCH'], [w.as('work-a', w.beta), 'TOPOLOGY_SENDER_MISMATCH'], [w.env, 'TOPOLOGY_SOURCE_IDENTITY_REQUIRED']]) {
    const refused = await ao(['mailbox', 'wait', 'w-1', '--timeout', '1s'], env);
    assert.deepEqual([refused.code, refused.json?.code], [1, code], refused.stdout);
    assert.doesNotMatch(refused.stdout, /secret answer/);
  }
  const answered = await ao(['mailbox', 'wait', 'w-1', '--timeout', '1s'], worker);
  assert.deepEqual([answered.code, answered.json?.reply?.body], [0, 'secret answer'], answered.stdout);
  const mcpLead = await mcpAs(w, { AO_AGENT_ID: 'lead-a', AO_CONSUMER: w.alpha });
  const error = await mcpLead.mailboxWait({ consumerCwd: w.alpha, id: 'w-1', timeoutMs: 500 }).then(() => null, (e) => e);
  assert.equal(error?.code, 'TOPOLOGY_SENDER_MISMATCH');
  assert.doesNotMatch(JSON.stringify({ message: error.message, details: error.details }), /secret answer/);
  const mcpWorker = await mcpAs(w, { AO_AGENT_ID: 'work-a', AO_CONSUMER: w.alpha });
  assert.equal((await mcpWorker.mailboxWait({ consumerCwd: w.alpha, id: 'w-1', timeoutMs: 500 })).reply.body, 'secret answer');
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
  const self = await handoff('work-a', w.as('work-a', w.alpha));
  assert.equal(self.json?.code, 'TOPOLOGY_AGENT_NOT_LIVE', 'the target itself passes the check and reaches the liveness check');
});
