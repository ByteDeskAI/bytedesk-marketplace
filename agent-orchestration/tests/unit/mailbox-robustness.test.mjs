// TM-482: one invalid NATS message must not block an inbox. TM-483: a failed publish retry, or an
// unreadable mailbox record, must not end the repository supervisor.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../../topology/lib/util.mjs';
import { canonicalRepoId } from '../../topology/lib/repoid.mjs';
import { createMailboxEnvelope, publishMailboxEnvelope, listMailboxPublications, mailboxLedgerRoot, acceptMailboxDelivery, getMailboxReceipt,
  setMailboxDisposition, listMailboxReceipts, resumeMailboxPublications } from '../../topology/lib/mailbox-receipts.mjs';
import { readStandingMessage, resumeStandingMessages, sendStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { wireMessageId } from '../../topology/lib/mailbox.mjs';
import { repoKey } from '../../topology/lib/repoid.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readStandingInbox } from '../../topology/lib/standing-mailbox.mjs';
import { superviseRepository } from '../../topology/lib/supervision.mjs';
import { discardLiveTransports, useTransportOpener } from '../../topology/lib/orch-transport.mjs';

async function tempRoot(t, label) {
  const root = await mkdtemp(join(tmpdir(), `ao-mailbox-robust-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** A JetStream-shaped queue: a NAKed message is redelivered first, as the broker does. */
function brokerQueue(bodies) {
  const queue = bodies.map((body, i) => ({ body, messageId: `m${i}`, settled: null }));
  const log = [];
  return {
    queue, log,
    transport: {
      kind: 'nats',
      async pullMail() {
        const item = queue.find(entry => !entry.settled);
        if (!item) return null;
        return { via: 'nats', subject: 'mail.repo.worker', messageId: item.messageId, body: item.body,
          ack: async () => { item.settled = 'ack'; log.push(['ack', item.messageId]); },
          nak: async () => { log.push(['nak', item.messageId]); },
          term: async () => { item.settled = 'term'; log.push(['term', item.messageId]); } };
      },
    },
  };
}

test('TM-482: an invalid message ahead of a valid one is quarantined and termed; the valid one is delivered', async t => {
  const root = await tempRoot(t, 'poison');
  const consumer = join(root, 'repo'); await mkdir(consumer);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const repositoryId = (await canonicalRepoId(consumer)).id;
  const valid = createMailboxEnvelope({ id: 'valid-1', repositoryId, from: 'lead', to: 'worker', body: 'real work' });
  const broker = brokerQueue(['   ', JSON.stringify(valid)]);
  const pages = [];
  const notify = async page => { pages.push(page); return { sent: true }; };

  const inbox = await readStandingInbox({ consumer, agent: 'worker', env, transport: broker.transport, notify, limit: 10 });

  assert.deepEqual(inbox.map(item => item.body), ['real work'], 'the valid message behind the invalid one is delivered');
  assert.deepEqual(broker.log, [['term', 'm0'], ['ack', 'm1']], 'the invalid message is termed, never NAKed');
  const deadDir = join(mailboxLedgerRoot({ env }), (await readdir(mailboxLedgerRoot({ env })))[0], 'dead-letter');
  const dead = (await readdir(deadDir)).filter(name => name.endsWith('.json'));
  assert.equal(dead.length, 1, 'exactly one dead-letter record');
  const record = JSON.parse(await readFile(join(deadDir, dead[0]), 'utf8'));
  assert.equal(record.code, 'TOPOLOGY_MAILBOX_ENVELOPE');
  assert.match(record.reason, /body/i);
  assert.equal(record.rawBody, '   ');
  assert.equal(record.agent, 'worker');
  assert.equal(pages.length, 1, 'the operator is told once');
  assert.match(pages[0].body, /TOPOLOGY_MAILBOX_ENVELOPE/);

  // A redelivery of the same bad bytes (term lost in a crash) is termed again but not re-paged.
  broker.queue[0].settled = null;
  await readStandingInbox({ consumer, agent: 'worker', env, transport: broker.transport, notify, limit: 10 });
  assert.equal(broker.queue[0].settled, 'term');
  assert.equal(pages.length, 1, 'the operator is not paged twice for one message');
});

test('TM-483: a failed publish retry is recorded with backoff, the tick survives, and a due tick retries', async t => {
  const root = await tempRoot(t, 'tick');
  const repo = join(root, 'repo'), home = join(root, 'home');
  await run('git', ['init', '-q', repo]);
  // tmux-test-isolation: TMUX blank, per-test TMUX_TMPDIR, and a server name that never exists.
  mkdirSync(join(root, 'tmux'), { recursive: true });
  const env = { ...process.env, TMUX: '', TMUX_TMPDIR: join(root, 'tmux'), HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AGENT_ORCHESTRATION_SERVICES: '0',
    AO_NATS_HOME: join(root, 'nats-home'), AO_NATS_AUTOSTART: '0', AO_TRANSPORT: 'nats', AO_NATS_URL: 'nats://127.0.0.1:1' };
  const pages = [];
  const options = { consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}-${Date.now()}`,
    notify: async page => { pages.push(page); return { sent: true }; } };

  let failPublish = true; const publishes = [];
  const restore = useTransportOpener(async () => {
    const transport = { kind: 'nats', closed: false, stats: () => ({ kind: 'nats', closed: transport.closed }),
      async putPresence() { return { via: 'nats' }; },
      async publishReply({ messageId }) {
        publishes.push(messageId);
        if (failPublish) throw Object.assign(new Error('broker refused'), { code: 'INJECTED_PUBLISH_FAILURE' });
        return { via: 'nats', subject: 'replies.repo.lead', seq: 1 };
      },
      async close() { transport.closed = true; } };
    return transport;
  });
  t.after(async () => { restore(); await discardLiveTransports(); });

  // A reply publication left pending by an earlier failure, already due.
  const repositoryId = (await canonicalRepoId(repo)).id;
  const envelope = createMailboxEnvelope({ id: 'reply-1', kind: 'reply', repositoryId, from: 'worker', to: 'lead', body: 'done', replyTo: 'ask-1' });
  await assert.rejects(publishMailboxEnvelope({ envelope, env, now: () => 0,
    transport: { kind: 'nats', publishReply: async () => { throw new Error('first failure'); } } }));
  // And an unreadable record in another repository's ledger.
  const foreign = join(mailboxLedgerRoot({ env }), 'some-other-repo', 'publications');
  await mkdir(foreign, { recursive: true }); await writeFile(join(foreign, 'broken.json'), '{not json');

  const first = await superviseRepository(options, { once: true });
  assert.equal(first.reconciled, true, 'the tick completes');
  assert.deepEqual(publishes, ['reply-1'], 'the due publication was retried');
  assert.deepEqual(first.mail_errors.find(e => e.messageId)?.code, 'INJECTED_PUBLISH_FAILURE', 'the retry failure is reported');
  assert.ok(first.mail_errors.some(e => e.file?.endsWith('broken.json')), 'the unreadable foreign record is reported and skipped');
  // F6: the skipped record is escalated to the operator, once per file.
  assert.equal(pages.filter(p => p.body.includes('broken.json')).length, 1, 'the unreadable record is paged');
  const [pending] = await listMailboxPublications({ consumer: repo, env, status: 'pending', allAgents: true, invalid: [] });
  assert.equal(pending.lastError, 'INJECTED_PUBLISH_FAILURE', 'the failure is recorded on the publication');
  assert.ok(Date.parse(pending.nextRetryAt) > Date.now(), 'with a backoff');

  assert.equal((await superviseRepository(options, { once: true })).reconciled, true);
  assert.deepEqual(publishes, ['reply-1'], 'a tick inside the backoff does not retry');
  assert.equal(pages.filter(p => p.body.includes('broken.json')).length, 1, 'the same unreadable file is not paged twice');

  failPublish = false;
  const later = await superviseRepository({ ...options, now: () => Date.now() + 3_600_000 }, { once: true });
  assert.deepEqual(publishes, ['reply-1', 'reply-1'], 'the next due tick retries');
  assert.equal((await listMailboxPublications({ consumer: repo, env, status: 'published', allAgents: true, invalid: [] })).length, 1);
  assert.equal(later.mail_errors?.some(e => e.messageId), false, 'nothing failed on the successful retry');
});

// ── Review findings on PR #229 ─────────────────────────────────────────────────────────────────

async function ledgerFixture(t, label) {
  const root = await tempRoot(t, label);
  const consumer = join(root, 'repo'); await mkdir(consumer);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const repositoryId = (await canonicalRepoId(consumer)).id;
  return { root, consumer, env, repositoryId, ledger: join(mailboxLedgerRoot({ env }), repoKey(repositoryId)) };
}
const settle = () => ({ ack: async () => {}, term: async () => {} });

test('F1: mailbox resume prints the failures it collected and exits non-zero', async t => {
  const f = await ledgerFixture(t, 'cli');
  const broken = join(mailboxLedgerRoot({ env: f.env }), 'some-other-repo', 'publications');
  await mkdir(broken, { recursive: true }); await writeFile(join(broken, 'broken.json'), '{not json');
  const home = join(f.root, 'home'); await mkdir(home);
  const result = spawnSync(process.execPath, [join(process.cwd(), 'topology/cli.mjs'), 'mailbox', 'resume', '--force', '--consumer', f.consumer, '--json'],
    { env: { ...process.env, ...f.env, HOME: home, TMUX: '', AO_TRANSPORT: 'file', AO_NATS_AUTOSTART: '0', AGENT_ORCHESTRATION_SERVICES: '0' }, encoding: 'utf8' });
  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const reported = JSON.parse(result.stderr.slice(result.stderr.indexOf('{')));
  assert.equal(reported.ok, false);
  assert.ok(reported.errors.some(e => e.file?.endsWith('broken.json')), result.stderr);
});

test('F2: a different sender reusing a reply ID gets its own receipt and cannot squat the real reply', async t => {
  const f = await ledgerFixture(t, 'squat');
  const id = 'ask-1.reply.worker', scope = { consumer: f.consumer, env: f.env, agent: 'lead', kind: 'reply', messageId: id };
  const reply = from => createMailboxEnvelope({ id, kind: 'reply', repositoryId: f.repositoryId, from, to: 'lead', body: `from ${from}`, replyTo: 'ask-1' });
  const receive = envelope => acceptMailboxDelivery({ consumer: f.consumer, env: f.env, agent: 'lead', kind: 'reply', notify: async () => ({}),
    delivery: { body: JSON.stringify(envelope), ...settle() } });
  await receive(reply('squatter'));
  const real = await receive(reply('worker'));
  assert.equal(real.quarantined, undefined, 'the real reply is accepted, not dead-lettered');
  assert.equal(real.status, 'accepted');
  assert.equal((await listMailboxReceipts({ consumer: f.consumer, env: f.env, agent: 'lead', kind: 'reply' })).length, 2);
  await assert.rejects(getMailboxReceipt(scope), { code: 'TOPOLOGY_MAILBOX_AMBIGUOUS' });
  assert.equal((await getMailboxReceipt({ ...scope, from: 'worker' })).envelope.body, 'from worker');
  assert.equal((await setMailboxDisposition({ ...scope, from: 'worker', disposition: 'handled' })).envelope.from, 'worker');
  assert.equal((await getMailboxReceipt({ ...scope, from: 'squatter' })).status, 'accepted', 'the squatter receipt is untouched');
  assert.equal((await receive(reply('worker'))).deduplicated, true, 'a redelivery of the real reply dedupes to its receipt');
});

test('F2: a run recreated in the same directory never reuses wire message IDs', () => {
  const first = wireMessageId('/runs/a', { run_id: 'same', created: '2026-10-01T00:00:00.000Z' }, 'm1');
  assert.notEqual(first, wireMessageId('/runs/a', { run_id: 'same', created: '2026-10-02T00:00:00.000Z' }, 'm1'));
  assert.equal(first, wireMessageId('/runs/a', { run_id: 'same', created: '2026-10-01T00:00:00.000Z' }, 'm1'), 'stable within one run');
  assert.notEqual(wireMessageId('/runs/a', { created: 'x' }, 'm1'), wireMessageId('/runs/a', { created: 'y' }, 'm1'));
});

test('F3: pages are limited to one per repository, agent and code per hour, with a running count; dead letters are capped', async t => {
  const f = await ledgerFixture(t, 'spam');
  const pages = []; let clock = Date.parse('2026-10-08T00:00:00.000Z');
  const receive = body => acceptMailboxDelivery({ consumer: f.consumer, env: f.env, agent: 'worker', now: () => clock,
    notify: async page => { pages.push(page); return { sent: true }; }, delivery: { body, ...settle() } });
  for (let i = 1; i <= 3; i += 1) await receive(' '.repeat(i));
  assert.equal(pages.length, 1, 'three invalid messages within the hour page once');
  clock += 61 * 60_000;
  await receive(' '.repeat(10));
  assert.equal(pages.length, 2, 'the next hour pages again');
  assert.match(pages[1].body, /2 more/, 'and says how many were not paged');
  for (let i = 0; i < 510; i += 1) await receive(' '.repeat(20 + i));
  const dead = (await readdir(join(f.ledger, 'dead-letter'))).filter(name => name.endsWith('.json'));
  assert.equal(dead.length, 500, 'the dead-letter directory is capped at 500 records');
});

test('F4: a dead letter written but never paged (a crash in between) is paged on redelivery', async t => {
  const f = await ledgerFixture(t, 'lostpage');
  const raw = '   ', dir = join(f.ledger, 'dead-letter');
  const file = join(dir, createHash('sha256').update(JSON.stringify(['mail', 'worker', raw])).digest('hex') + '.json');
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: 'mail', agent: 'worker', repositoryId: f.repositoryId, code: 'TOPOLOGY_MAILBOX_ENVELOPE',
    reason: 'Message body must contain at most 1 MiB.', subject: null, messageId: null, rawBody: raw, quarantinedAt: '2026-10-08T00:00:00.000Z' }));
  const pages = [];
  await acceptMailboxDelivery({ consumer: f.consumer, env: f.env, agent: 'worker', notify: async page => { pages.push(page); return { sent: true }; },
    delivery: { body: raw, ...settle() } });
  assert.equal(pages.length, 1, 'the page the crash lost is sent');
  assert.ok(JSON.parse(await readFile(file, 'utf8')).notifiedAt, 'and recorded, so the next redelivery does not page again');
});

test('F5: an EACCES publication file is skipped and reported; the other publications still retry', async t => {
  const f = await ledgerFixture(t, 'eacces');
  const failing = { kind: 'nats', publishReply: async () => { throw new Error('offline'); } };
  const envelope = id => createMailboxEnvelope({ id, kind: 'reply', repositoryId: f.repositoryId, from: 'worker', to: 'lead', body: id, replyTo: 'ask' });
  for (const id of ['locked', 'open']) await assert.rejects(publishMailboxEnvelope({ envelope: envelope(id), env: f.env, transport: failing }));
  const dir = join(f.ledger, 'publications');
  let locked = null;
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.json'))) {
    if (JSON.parse(await readFile(join(dir, name), 'utf8')).messageId === 'locked') locked = join(dir, name);
  }
  await chmod(locked, 0o000); t.after(() => chmod(locked, 0o600).catch(() => {})); // rm runs first and removes it
  const published = [], errors = [];
  const ok = { kind: 'nats', publishReply: async ({ messageId }) => { published.push(messageId); return { subject: 's', seq: 1 }; } };
  await resumeMailboxPublications({ consumer: f.consumer, env: f.env, transport: ok, force: true, errors });
  assert.deepEqual(published, ['open'], 'the readable publication is retried');
  assert.ok(errors.some(e => e.file === locked && e.code === 'EACCES'), JSON.stringify(errors));
});

test('F5: a publication sweep that fails outright keeps the standing results already resumed', async t => {
  const f = await ledgerFixture(t, 'keep');
  const transport = { kind: 'nats', publishMail: async () => { throw new Error('no broker acknowledgement'); } };
  const options = { env: f.env, transport, notify: async () => ({}), router: async () => ({ resolved: 'worker', deliver_to: 'worker' }) };
  const sent = await sendStandingMessage({ id: 'keep-1', consumer: f.consumer, fromProject: f.consumer, from: 'lead', to: 'worker', body: 'keep me' }, options);
  assert.equal(sent.status, 'publishing');
  transport.publishMail = async () => ({ subject: 'test', seq: 1 });
  const root = mailboxLedgerRoot({ env: f.env });
  await chmod(root, 0o300); // no longer listable, still writable
  const errors = [];
  let resumed;
  try { resumed = await resumeStandingMessages({ consumer: f.consumer, ...options, force: true, errors }); }
  finally { await chmod(root, 0o700); } // before the temp-root cleanup, which must list it
  assert.deepEqual(resumed.map(r => [r.envelope.id, r.status]), [['keep-1', 'delivered']]);
  assert.equal((await readStandingMessage({ id: 'keep-1', env: f.env })).status, 'delivered');
  assert.ok(errors.some(e => e.code === 'EACCES'), JSON.stringify(errors));
});

// ── Delta review on PR #229 ────────────────────────────────────────────────────────────────────

test('N1: a corrupt file in receipts/ does not stop disposal of an unrelated message', async t => {
  const f = await ledgerFixture(t, 'corrupt-receipt');
  const envelope = createMailboxEnvelope({ id: 'job-1', repositoryId: f.repositoryId, from: 'lead', to: 'worker', body: 'work' });
  await acceptMailboxDelivery({ consumer: f.consumer, env: f.env, agent: 'worker', delivery: { body: JSON.stringify(envelope), ...settle() } });
  await writeFile(join(f.ledger, 'receipts', 'corrupt.json'), '{not json');
  const scope = { consumer: f.consumer, env: f.env, agent: 'worker', messageId: 'job-1' };
  assert.equal((await setMailboxDisposition({ ...scope, disposition: 'deferred', reason: 'later', retryAt: '2030-01-01T00:00:00.000Z' })).status, 'deferred', 'by ID alone');
  assert.equal((await setMailboxDisposition({ ...scope, from: 'lead', disposition: 'handled' })).status, 'handled', 'by ID and sender');
  assert.equal((await getMailboxReceipt(scope)).status, 'handled');
});

test('N2: the CLI and MCP can name the receipt whose sender is null when an ID is ambiguous', async t => {
  const f = await ledgerFixture(t, 'null-sender');
  const deliver = from => acceptMailboxDelivery({ consumer: f.consumer, env: f.env, agent: 'worker', notify: async () => ({}), delivery: {
    body: JSON.stringify(createMailboxEnvelope({ id: 'shared', repositoryId: f.repositoryId, from, to: 'worker', body: `from ${from}` })), ...settle() } });
  await deliver(null); await deliver('lead');
  const home = join(f.root, 'home'); await mkdir(home);
  const result = spawnSync(process.execPath, [join(process.cwd(), 'topology/cli.mjs'), 'mailbox', 'dispose', '--consumer', f.consumer,
    '--message', 'shared', '--sender', '', '--disposition', 'handled', '--json'],
  { env: { ...process.env, ...f.env, HOME: home, TMUX: '', AO_TRANSPORT: 'file', AO_NATS_AUTOSTART: '0', AGENT_ORCHESTRATION_SERVICES: '0',
    AO_AGENT_ID: 'worker', AO_CONSUMER: f.consumer }, encoding: 'utf8' });
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).envelope.from, null);
  assert.equal((await getMailboxReceipt({ consumer: f.consumer, env: f.env, agent: 'worker', messageId: 'shared', from: 'lead' })).status, 'accepted');
  const { createServer } = await import('../../src/mcp.mjs');
  await mkdir(join(f.root, 'plugin'));
  const { server } = await createServer({ pluginRoot: join(f.root, 'plugin'), stateRoot: join(f.root, 'mcp-state'), autoRecover: false });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const client = new Client({ name: 'n2', version: '1.0.0' }), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const tool = (await client.listTools()).tools.find(entry => entry.name === 'orchestration_mailbox_dispose');
    assert.match(JSON.stringify(tool.inputSchema.properties.sender), /null/, 'the MCP sender field accepts null');
  } finally { await client.close().catch(() => {}); await server.close().catch(() => {}); }
});

test('N3: a failing escalation is reported and the standing results are kept', async t => {
  const f = await ledgerFixture(t, 'escalation');
  const transport = { kind: 'nats', publishMail: async () => { throw new Error('no broker acknowledgement'); } };
  const options = { env: f.env, transport, notify: async () => ({}), router: async () => ({ resolved: 'worker', deliver_to: 'worker' }) };
  await sendStandingMessage({ id: 'keep-2', consumer: f.consumer, fromProject: f.consumer, from: 'lead', to: 'worker', body: 'keep me' }, options);
  transport.publishMail = async () => ({ subject: 'test', seq: 1 });
  const root = mailboxLedgerRoot({ env: f.env });
  await mkdir(join(root, 'other-repo', 'publications'), { recursive: true });
  await writeFile(join(root, 'other-repo', 'publications', 'broken.json'), '{not json'); // something to escalate
  await writeFile(join(root, 'escalated'), 'a file where the marker directory belongs'); // so escalation fails
  const errors = [];
  const resumed = await resumeStandingMessages({ consumer: f.consumer, ...options, force: true, errors });
  assert.deepEqual(resumed.map(r => [r.envelope.id, r.status]), [['keep-2', 'delivered']]);
  assert.ok(errors.some(e => e.code === 'ENOTDIR'), JSON.stringify(errors));
});
