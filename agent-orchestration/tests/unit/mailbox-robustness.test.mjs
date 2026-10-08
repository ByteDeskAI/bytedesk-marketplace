// TM-482: one invalid NATS message must not block an inbox. TM-483: a failed publish retry, or an
// unreadable mailbox record, must not end the repository supervisor.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../../topology/lib/util.mjs';
import { canonicalRepoId } from '../../topology/lib/repoid.mjs';
import { createMailboxEnvelope, publishMailboxEnvelope, listMailboxPublications, mailboxLedgerRoot } from '../../topology/lib/mailbox-receipts.mjs';
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
  const options = { consumer: repo, home, env, tmuxServer: `ao-absent-${process.pid}-${Date.now()}` };

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
  const [pending] = await listMailboxPublications({ consumer: repo, env, status: 'pending', allAgents: true, invalid: [] });
  assert.equal(pending.lastError, 'INJECTED_PUBLISH_FAILURE', 'the failure is recorded on the publication');
  assert.ok(Date.parse(pending.nextRetryAt) > Date.now(), 'with a backoff');

  assert.equal((await superviseRepository(options, { once: true })).reconciled, true);
  assert.deepEqual(publishes, ['reply-1'], 'a tick inside the backoff does not retry');

  failPublish = false;
  const later = await superviseRepository({ ...options, now: () => Date.now() + 3_600_000 }, { once: true });
  assert.deepEqual(publishes, ['reply-1', 'reply-1'], 'the next due tick retries');
  assert.equal((await listMailboxPublications({ consumer: repo, env, status: 'published', allAgents: true, invalid: [] })).length, 1);
  assert.equal(later.mail_errors?.some(e => e.messageId), false, 'nothing failed on the successful retry');
});
