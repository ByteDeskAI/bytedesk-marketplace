import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalRepoId } from '../../topology/lib/repoid.mjs';
import { createMailboxEnvelope, acceptMailboxDelivery, getMailboxReceipt, listMailboxReceipts, listMailboxPublications, setMailboxDisposition, publishMailboxEnvelope, resumeMailboxPublications } from '../../topology/lib/mailbox-receipts.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-receipts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'); await mkdir(consumer);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const repositoryId = (await canonicalRepoId(consumer)).id;
  const envelope = createMailboxEnvelope({ id: 'obligation-1', repositoryId, from: 'lead', to: 'worker', body: 'do scoped work', context: { workflowId: 'topology:one', taskId: 'TM-1' } });
  return { consumer, env, repositoryId, envelope };
}

test('accepted obligation survives ACK crash and repeated delivery without duplicate work', async t => {
  const f = await fixture(t); let acks = 0;
  const delivery = { body: JSON.stringify(f.envelope), messageId: f.envelope.id, ack: async () => { acks++; throw new Error('crash after ACK'); } };
  await assert.rejects(acceptMailboxDelivery({ ...f, agent: 'worker', delivery }), /crash after ACK/);
  assert.equal((await getMailboxReceipt({ ...f, agent: 'worker', messageId: f.envelope.id })).status, 'accepted');
  const replay = await acceptMailboxDelivery({ ...f, agent: 'worker', delivery: { ...delivery, ack: async () => { acks++; } } });
  assert.equal(replay.deduplicated, true); assert.equal(acks, 2);
  assert.equal((await listMailboxReceipts(f)).length, 1);
  await setMailboxDisposition({ ...f, agent: 'worker', messageId: f.envelope.id, disposition: 'handled', resultRef: 'artifact:verified' });
  const duplicate = await acceptMailboxDelivery({ ...f, agent: 'worker', delivery: { ...delivery, ack: async () => { acks++; } } });
  assert.equal(duplicate.status, 'handled');
  assert.equal((await listMailboxReceipts({ ...f, status: 'accepted' })).length, 0);
});

test('changed immutable content and foreign recipient never ACK; deferred obligations stay visible', async t => {
  const f = await fixture(t); let acks = 0;
  const receive = envelope => acceptMailboxDelivery({ ...f, agent: 'worker', delivery: { body: JSON.stringify(envelope), ack: async () => { acks++; } } });
  await receive(f.envelope);
  await assert.rejects(receive(createMailboxEnvelope({ ...f.envelope, body: 'different' })), { code: 'TOPOLOGY_MESSAGE_ID_CONFLICT' });
  await assert.rejects(receive(createMailboxEnvelope({ ...f.envelope, to: 'other' })), { code: 'TOPOLOGY_MAILBOX_IDENTITY' });
  assert.equal(acks, 1);
  await setMailboxDisposition({ ...f, agent: 'worker', messageId: f.envelope.id, disposition: 'deferred', reason: 'dependency', retryAt: '2030-01-01T00:00:00.000Z' });
  assert.equal((await listMailboxReceipts({ ...f, workflowId: 'topology:one', taskId: 'TM-1' }))[0].status, 'deferred');
  assert.equal((await listMailboxReceipts({ ...f, agent: 'other' })).length, 0);
});

test('publication intent survives broker failure and sender retry deduplicates beyond broker window', async t => {
  const f = await fixture(t); let attempts = 0;
  const transport = { kind: 'nats', publishMail: async () => { if (++attempts === 1) throw new Error('broker unavailable'); return { subject: 'test', seq: 1 }; } };
  await assert.rejects(publishMailboxEnvelope({ ...f, transport }), /broker unavailable/);
  const [recovered] = await resumeMailboxPublications({ ...f, transport });
  assert.equal(recovered.status, 'published'); assert.equal(attempts, 2);
  await publishMailboxEnvelope({ ...f, transport }); assert.equal(attempts, 2);
  await assert.rejects(publishMailboxEnvelope({ ...f, envelope: createMailboxEnvelope({ ...f.envelope, body: 'changed' }), transport }), { code: 'TOPOLOGY_MESSAGE_ID_CONFLICT' });
});

test('legacy file standing receive keeps its envelope and records a durable accepted obligation', async t => {
  const f = await fixture(t);
  const { sendStandingMessage, readStandingInbox } = await import('../../topology/lib/standing-mailbox.mjs');
  const options = { env: { ...f.env, AO_TRANSPORT: 'file' }, router: async () => ({ resolved: 'worker', deliver_to: 'worker' }) };
  await sendStandingMessage({ id: 'file-obligation', consumer: f.consumer, fromProject: f.consumer, from: 'lead', to: 'worker', body: 'legacy body' }, options);
  const [received] = await readStandingInbox({ consumer: f.consumer, agent: 'worker', ...options });
  assert.equal(received.envelope.body, 'legacy body');
  assert.equal((await getMailboxReceipt({ ...f, agent: 'worker', messageId: 'file-obligation' }))?.status, 'accepted');
});

test('publication view separates sender PubAck from receipt and filters source identity without transport calls', async t => {
  const f = await fixture(t), destination = join(f.consumer, 'other'); await mkdir(destination);
  const destinationId = (await canonicalRepoId(destination)).id;
  const envelope = createMailboxEnvelope({ ...f.envelope, repositoryId: destinationId,
    context: { sourceRepositoryId: f.repositoryId, workflowId: 'goal:one', runId: 'one', taskId: 'TM-1' } });
  let calls = 0;
  const transport = { kind: 'nats', publishMail: async () => { calls++; throw new Error('offline'); } };
  await assert.rejects(publishMailboxEnvelope({ ...f, envelope, transport }), /offline/);
  assert.equal((await listMailboxPublications({ ...f, agent: 'lead', workflowId: 'goal:one', runId: 'one', taskId: 'TM-1' }))[0].status, 'pending');
  assert.equal((await listMailboxPublications({ ...f, consumer: destination })).length, 0);
  assert.equal((await listMailboxPublications({ ...f, agent: 'worker' })).length, 0);
  assert.equal((await listMailboxReceipts(f)).length, 0); assert.equal(calls, 1);
  transport.publishMail = async () => { calls++; return { subject: 'test', seq: 1 }; };
  await resumeMailboxPublications({ ...f, transport });
  assert.equal((await listMailboxPublications({ ...f, status: 'published' })).length, 1);
  assert.equal((await listMailboxPublications({ ...f, status: 'pending' })).length, 0);
  assert.equal((await listMailboxReceipts({ ...f, consumer: destination })).length, 0);
  assert.equal(calls, 2);
});

test('uncertain standing publication stays inspectable and resume records delivered only after PubAck', async t => {
  const f = await fixture(t);
  const { sendStandingMessage, readStandingMessage, resumeStandingMessages } = await import('../../topology/lib/standing-mailbox.mjs');
  const transport = { kind: 'nats', publishMail: async () => { throw new Error('no broker acknowledgement'); } };
  const options = { env: f.env, transport, router: async () => ({ resolved: 'worker', deliver_to: 'worker' }) };
  const sent = await sendStandingMessage({ id: 'uncertain', consumer: f.consumer, fromProject: f.consumer, from: 'lead', to: 'worker', body: 'retain me' }, options);
  assert.equal(sent.status, 'publishing');
  const pending = await readStandingMessage({ id: 'uncertain', env: f.env });
  assert.equal(pending.status, 'publishing'); assert.equal(pending.delivered_at, undefined);
  transport.publishMail = async () => ({ subject: 'test', seq: 1 });
  await resumeStandingMessages({ consumer: f.consumer, ...options, force: true });
  const delivered = await readStandingMessage({ id: 'uncertain', env: f.env });
  assert.equal(delivered.status, 'delivered'); assert.ok(delivered.delivered_at);
  assert.equal(delivered.publication.status, 'published');
});
