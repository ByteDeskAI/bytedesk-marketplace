import { natsServerBin } from '../helpers/nats-server.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { openNatsTransport, ORCH_LAYOUT } from '../../topology/lib/orch-transport.mjs';
import { createMailboxEnvelope, publishMailboxEnvelope, listMailboxReceipts, setMailboxDisposition, resumeMailboxPublications } from '../../topology/lib/mailbox-receipts.mjs';
import { sendStandingMessage, resumeStandingMessages, readStandingInbox } from '../../topology/lib/standing-mailbox.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
const exec = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const moduleURL = name => new URL(`../../topology/lib/${name}.mjs`, import.meta.url).href;

test('installed topology uses its shipped NATS client without node_modules or source siblings', async t => {
  const f = await fixture(t), install = join(f.root, 'installed');
  await mkdir(join(install, 'dist'), { recursive: true });
  await cp(fileURLToPath(new URL('../../topology', import.meta.url)), join(install, 'topology'), { recursive: true });
  await cp(fileURLToPath(new URL('../../dist/nats-client.cjs', import.meta.url)), join(install, 'dist/nats-client.cjs'));
  const output = await f.runChild(`
    const { openNatsTransport } = await import(${JSON.stringify('file:')} + ${JSON.stringify(join(install, 'topology/lib/orch-transport.mjs'))});
    const transport = await openNatsTransport({ servers: process.env.AO_NATS_URL });
    try {
      await transport.ensure({repo:${JSON.stringify(f.repo)},agents:['worker']});
      await transport.publishMail({repo:${JSON.stringify(f.repo)},agent:'worker',messageId:'installed-proof',body:'installed client'});
      const delivery=await transport.pullMail({repo:${JSON.stringify(f.repo)},agent:'worker'});
      if(delivery?.body!=='installed client') throw Error('installed receive failed');
      await delivery.ack(); process.stdout.write('installed-publish-receive-ok');
    } finally { await transport.close(); }
  `);
  assert.equal(output, 'installed-publish-receive-ok');
});

async function fixture(t) {
  const bin = await natsServerBin(); // Same pinned prerequisite as the transport contract.
  const root = await mkdtemp(join(tmpdir(), 'ao-receipt-nats-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const child = spawn(bin, ['-js', '-a', '127.0.0.1', '-p', String(port), '-sd', join(root, 'broker')], { stdio: 'ignore' });
  const servers = `nats://127.0.0.1:${port}`;
  let transport;
  t.after(async () => { await transport?.close(); const exited = new Promise(resolve => child.once('exit', resolve)); if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } await rm(root, { recursive: true, force: true }); });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { transport = await openNatsTransport({ servers }); break; } catch { await pause(50); }
  }
  assert.ok(transport, 'isolated broker starts');
  const consumer = join(root, 'repo'); await mkdir(consumer);
  const env = { ...process.env, AO_TRANSPORT: 'nats', AO_NATS_URL: servers, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_AGENT_ID: '', AO_CONSUMER: '', TMUX: '' };
  const repositoryId = (await canonicalRepoId(consumer)).id, repo = repoKey(repositoryId);
  const make = (id, extra = {}) => createMailboxEnvelope({ id, repositoryId, from: 'lead', to: 'worker', body: `work ${id}`, context: {}, ...extra });
  const runChild = async (script, expected = 0) => {
    try { const result = await exec(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 15000 }); assert.equal(expected, 0); return result.stdout; }
    catch (error) { if (typeof error.code === 'number' && error.code === expected) return error.stdout; throw error; }
  };
  return { root, consumer, env, repositoryId, repo, transport, servers, make, runChild };
}

test('real NATS redelivers before acceptance and durable acceptance survives process exit before ACK', async t => {
  const f = await fixture(t);
  await f.transport.ensure({ repo: f.repo, agents: ['worker'] });
  const manager = await f.transport.nc.jetstreamManager();
  const info = await manager.consumers.info(ORCH_LAYOUT.mailStream, ORCH_LAYOUT.mailDurable(f.repo, 'worker'));
  await manager.consumers.update(ORCH_LAYOUT.mailStream, info.name, { ...info.config, ack_wait: 200_000_000 });
  for (const [id, persist, code] of [['before-write', false, 23], ['after-write', true, 24]]) {
    await publishMailboxEnvelope({ envelope: f.make(id), transport: f.transport, env: f.env });
    await f.runChild(`
      const { openNatsTransport } = await import(${JSON.stringify(moduleURL('orch-transport'))});
      const transport = await openNatsTransport({ servers: process.env.AO_NATS_URL });
      const delivery = await transport.pullMail({ repo: ${JSON.stringify(f.repo)}, agent: 'worker' });
      if (!delivery) throw Error('missing delivery');
      ${persist ? `const { acceptMailboxDelivery } = await import(${JSON.stringify(moduleURL('mailbox-receipts'))}); await acceptMailboxDelivery({ consumer:${JSON.stringify(f.consumer)},agent:'worker',delivery:{...delivery,ack:async()=>process.exit(${code})} });` : `process.exit(${code});`}
    `, code);
    const before = await listMailboxReceipts({ consumer: f.consumer, env: f.env });
    assert.equal(before.some(item => item.messageId === id), persist);
    await pause(250);
    const inbox = await readStandingInbox({ consumer: f.consumer, agent: 'worker', env: f.env, transport: f.transport, limit: 2 });
    assert.equal(inbox.filter(item => item.messageId === id).length, 1);
    await setMailboxDisposition({ consumer: f.consumer, agent: 'worker', messageId: id, disposition: 'handled', resultRef: 'verified-result', env: f.env });
  }
  assert.equal((await listMailboxReceipts({ consumer: f.consumer, env: f.env })).length, 2);
});

test('held standing obligation is actually published on recovery and retries retain one accepted obligation', async t => {
  const f = await fixture(t), source = join(f.root, 'source'); await mkdir(source);
  let ready = false;
  const options = { env: f.env, transport: f.transport, readiness: async () => ({ status: ready ? 'responsive' : 'unresponsive', record: { agent_id: 'lead' }, library_lead: 'lead' }),
    enrollment: async () => ({ enrolled: true }), requestRecovery: async () => {}, activate: async () => ({}),
    router: async () => ({ deliver_to: 'worker', resolved: 'worker', redirected: false }) };
  const input = { id: 'phase-obligation', consumer: f.consumer, fromProject: source, from: 'lead', to: 'worker', body: 'original phase', context: { workflowId: 'loop:goal', taskId: 'TM-267' } };
  assert.equal((await sendStandingMessage(input, options)).status, 'held');
  assert.equal((await listMailboxReceipts({ consumer: f.consumer, env: f.env })).length, 0);
  ready = true;
  const [resumed] = await resumeStandingMessages({ consumer: f.consumer, force: true, ...options });
  assert.equal(resumed.status, 'delivered'); assert.equal(resumed.publication.status, 'published');
  const received = await readStandingInbox({ consumer: f.consumer, agent: 'worker', env: f.env, transport: f.transport });
  assert.equal(received.length, 1); assert.equal(received[0].envelope.id, input.id);
  assert.equal(received[0].envelope.context.workflowId, 'loop:goal');
  await sendStandingMessage(input, options);
  assert.equal((await readStandingInbox({ consumer: f.consumer, agent: 'worker', env: f.env, transport: f.transport })).length, 1);
});

test('uncertain sender publish recovers after broker dedup window without duplicate recipient obligation', async t => {
  const f = await fixture(t), envelope = f.make('uncertain');
  await f.transport.ensure({ repo: f.repo, agents: ['worker'] });
  const manager = await f.transport.nc.jetstreamManager(), info = await manager.streams.info(ORCH_LAYOUT.mailStream);
  await manager.streams.update(ORCH_LAYOUT.mailStream, { ...info.config, duplicate_window: 100_000_000 });
  await assert.rejects(publishMailboxEnvelope({ envelope, env: f.env, transport: { kind: 'nats', publishMail: async input => {
    await f.transport.publishMail(input); throw Error('sender lost PubAck');
  } } }), /sender lost PubAck/);
  await readStandingInbox({ consumer: f.consumer, agent: 'worker', env: f.env, transport: f.transport });
  await pause(150);
  await resumeMailboxPublications({ consumer: f.consumer, env: f.env, transport: f.transport });
  assert.equal((await readStandingInbox({ consumer: f.consumer, agent: 'worker', env: f.env, transport: f.transport })).length, 1);
  const stored = await listMailboxReceipts({ consumer: f.consumer, env: f.env }); assert.equal(stored.length, 1);
});

test('run replies remain available to a second waiter process after broker ACK', async t => {
  const f = await fixture(t), runDir = join(f.root, 'run');
  await writeJson(join(runDir, 'run.json'), { version: 1, consumer: f.consumer, run_id: 'replay', name: 'replay', state_home: f.env.AGENT_ORCHESTRATION_STATE_HOME,
    agents: [{ id: 'lead', role: 'orchestrator' }, { id: 'worker', role: 'worker' }] });
  const common = `const api=await import(${JSON.stringify(moduleURL('mailbox'))}); const runDir=${JSON.stringify(runDir)};`;
  const sent = JSON.parse(await f.runChild(`${common} const sent=await api.sendMessage({runDir,from:'lead',to:['worker'],fromProject:${JSON.stringify(f.consumer)},stage:'brief',body:'reply needed'}); console.log(JSON.stringify(sent)); await (await import(${JSON.stringify(moduleURL('orch-transport'))})).closeLiveTransports();`));
  await f.runChild(`${common} await api.recordReply({runDir,agentId:'worker',messageId:${JSON.stringify(sent.id)},body:'verified answer'}); await (await import(${JSON.stringify(moduleURL('orch-transport'))})).closeLiveTransports();`);
  const wait = `${common} const result=await api.waitForReplies({runDir,agentIds:['worker'],messageId:${JSON.stringify(sent.id)},timeoutMs:3000,pollMs:50}); console.log(JSON.stringify(result)); await (await import(${JSON.stringify(moduleURL('orch-transport'))})).closeLiveTransports();`;
  const first = JSON.parse(await f.runChild(wait)), second = JSON.parse(await f.runChild(wait));
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(second.replies[0].body, 'verified answer');
});
