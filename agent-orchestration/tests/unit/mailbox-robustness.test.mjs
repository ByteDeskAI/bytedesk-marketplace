// TM-482: one invalid NATS message must not block an inbox.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalRepoId } from '../../topology/lib/repoid.mjs';
import { createMailboxEnvelope, mailboxLedgerRoot } from '../../topology/lib/mailbox-receipts.mjs';
import { readStandingInbox } from '../../topology/lib/standing-mailbox.mjs';

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
