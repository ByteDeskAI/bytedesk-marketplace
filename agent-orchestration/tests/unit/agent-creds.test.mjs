// TM-310: per-agent NATS credentials. Every protection below has a control that FAILS when the
// protection is removed (the mutation tests), and every refusal prints the server's own words.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { natsServerBin } from '../helpers/nats-server.mjs';
import { CredStore, agentPermissions, isDescendant, loadAgentUsers } from '../../topology/lib/agent-creds.mjs';
import { launcherScript } from '../../topology/lib/launch.mjs';
import { rewriteServerConfig, serverConfig } from '../../topology/lib/nats-local.mjs';
import { ORCH_LAYOUT } from '../../topology/lib/orch-transport.mjs';

// Ambient server selection must never reach these tests.
delete process.env.AO_NATS_URL;
delete process.env.NATS_URL;
delete process.env.AO_CREDS_SOCK;
const nats = await import('nats');
const REPO = 'repoK';
const enc = new TextEncoder();

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

async function startServer() {
  const home = await mkdtemp(join(os.tmpdir(), 'ao-creds-home-'));
  const port = await freePort();
  await writeFile(join(home, 'state.json'), JSON.stringify({ managed: true, pid: null, port, user: 'host', pass: 'host-pass-not-an-agent-secret' }));
  const conf = await rewriteServerConfig(home);
  const child = spawn(await natsServerBin(), ['-c', conf], { stdio: ['ignore', 'ignore', 'ignore'] });
  const url = `nats://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { (await nats.connect({ servers: url, user: 'host', pass: 'host-pass-not-an-agent-secret', timeout: 500 })).close(); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  const store = new CredStore({ home, serverPid: child.pid });
  const admin = await nats.connect({ servers: url, user: 'host', pass: 'host-pass-not-an-agent-secret' });
  const jsm = await admin.jetstreamManager();
  const js = admin.jetstream();
  await jsm.streams.add({ name: ORCH_LAYOUT.mailStream, subjects: ['orch.*.mail.>'], retention: nats.RetentionPolicy.Workqueue });
  for (const bucket of [ORCH_LAYOUT.agentsBucket, ORCH_LAYOUT.claimsBucket, ORCH_LAYOUT.presenceBucket]) await js.views.kv(bucket);
  for (const agent of ['agentA', 'agentB', 'boss']) {
    await jsm.consumers.add(ORCH_LAYOUT.mailStream, { durable_name: ORCH_LAYOUT.mailDurable(REPO, agent), filter_subject: ORCH_LAYOUT.mailSubject(REPO, agent), ack_policy: nats.AckPolicy.Explicit });
  }
  return { home, port, url, child, store, admin, jsm, js, conf,
    async stop() { await admin.close().catch(() => {}); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); } };
}

/** An agent connection that records every server -ERR (a publish violation is only ever reported there). */
async function connectAgent(server, issued, { retries = 0 } = {}) {
  const refusals = [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      const nc = await nats.connect({ servers: server.url, authenticator: nats.nkeyAuthenticator(enc.encode(issued.seed)), inboxPrefix: issued.inboxPrefix,
        maxReconnectAttempts: 0, timeout: 3000, name: issued.agent });
      (async () => { for await (const status of nc.status()) if (status.type === 'error') refusals.push(String(status.error?.message ?? status.data)); })();
      return { nc, refusals };
    } catch (error) {
      // SIGHUP is asynchronous: a key issued a moment ago may not be loaded yet. Only fixture setup retries; a revoked-key probe must not.
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

/** Run an operation; report whether it succeeded and every refusal text the server produced. */
async function attempt({ nc, refusals }, operation) {
  const before = refusals.length;
  try { await operation(nc); } catch (error) { refusals.push(`thrown: ${error.message}`); }
  await new Promise((r) => setTimeout(r, 150));
  const text = refusals.slice(before);
  return { ok: text.length === 0, refusal: text.join(' | ') };
}

const OPS = {
  'publish to A\'s mail subject': (nc) => nc.jetstream({ timeout: 1000 }).publish(ORCH_LAYOUT.mailSubject(REPO, 'agentA'), enc.encode('forged')),
  'read A\'s mail durable': async (nc) => { const c = await nc.jetstream({ timeout: 1000 }).consumers.get(ORCH_LAYOUT.mailStream, ORCH_LAYOUT.mailDurable(REPO, 'agentA')); await c.next({ expires: 1500 }); },
  'write a claim': async (nc) => { const kv = await nc.jetstream({ timeout: 1000 }).views.kv(ORCH_LAYOUT.claimsBucket, { bindOnly: true }); await kv.put(`${REPO}.TM-1`, enc.encode('{"by":"B"}')); },
  'delete a stream': (nc) => nc.jetstreamManager({ timeout: 1000 }).then((m) => m.streams.delete(ORCH_LAYOUT.mailStream)),
  'purge a stream': (nc) => nc.jetstreamManager({ timeout: 1000 }).then((m) => m.streams.purge(ORCH_LAYOUT.mailStream)),
};

async function fixture() {
  const server = await startServer();
  const a = await server.store.issue({ repo: REPO, agent: 'agentA', role: 'worker', mailTo: ['boss'] });
  const b = await server.store.issue({ repo: REPO, agent: 'agentB', role: 'worker', mailTo: ['boss'] });
  return { server, a, b, conn: { a: await connectAgent(server, a, { retries: 20 }), b: await connectAgent(server, b, { retries: 20 }) } };
}

test('(1) agent B is refused A\'s mail, A\'s durable, claims and stream deletion; A\'s own path works', async () => {
  const { server, a, conn } = await fixture();
  try {
    // Positive control: the same machinery lets A do what A is entitled to, so a refusal is the grant, not a dead connection.
    const own = await attempt(conn.a, async (nc) => { const c = await nc.jetstream({ timeout: 2000 }).consumers.get(ORCH_LAYOUT.mailStream, ORCH_LAYOUT.mailDurable(REPO, 'agentA')); await c.next({ expires: 1500 }); });
    assert.equal(own.ok, true, `A could not read its own durable: ${own.refusal}`);
    const toBoss = await attempt(conn.a, (nc) => nc.jetstream({ timeout: 2000 }).publish(ORCH_LAYOUT.mailSubject(REPO, 'boss'), enc.encode('reply')));
    assert.equal(toBoss.ok, true, `A could not reply to its lead: ${toBoss.refusal}`);
    for (const [name, operation] of Object.entries(OPS)) {
      const result = await attempt(conn.b, operation);
      console.log(`B ${name}: ${JSON.stringify(result)}`);
      assert.equal(result.ok, false, `B was NOT refused: ${name}`);
      assert.match(result.refusal, /Permissions Violation|timeout|TIMEOUT|503|no responders/i, `B refusal for ${name} carried no server reason: ${result.refusal}`);
    }
    // The server-side truth, not the client's story: the stream and its workqueue are intact, no claim exists.
    assert.equal((await server.jsm.streams.info(ORCH_LAYOUT.mailStream)).config.name, ORCH_LAYOUT.mailStream);
    const claims = await server.js.views.kv(ORCH_LAYOUT.claimsBucket);
    assert.equal(await claims.get(`${REPO}.TM-1`), null, 'B managed to write a claim');
    const info = await server.jsm.streams.info(ORCH_LAYOUT.mailStream);
    assert.equal(info.state.messages, 1, 'only A\'s reply to boss may be in the stream; B\'s forged mail is not');
    assert.ok(a.publicKey.startsWith('U'));
  } finally { await conn.a.nc.close().catch(() => {}); await conn.b.nc.close().catch(() => {}); await server.stop(); }
});

test('(5a) mutation: with agent permissions opened up the same attempts succeed, so test (1) can fail', async () => {
  const { server, b, conn } = await fixture();
  try {
    // Re-render the config with B's key given everything (and B's narrowed entry removed). This is "the protection removed".
    const open = `{ nkey: ${b.publicKey}, permissions: { publish: { allow: [">"] }, subscribe: { allow: [">"] } } }`;
    const state = JSON.parse(readFileSync(join(server.home, 'state.json'), 'utf8'));
    const base = serverConfig({ port: state.port, user: state.user, password: state.pass, storeDir: join(server.home, 'jetstream'),
      agentUsers: loadAgentUsers(server.home).filter((entry) => entry.agent !== 'agentB') });
    assert.ok(base.includes('users = [ '), 'sanity: the config shape the mutation relies on');
    await writeFile(server.conf, base.replace('users = [ ', `users = [ ${open}, `));
    server.child.kill('SIGHUP');
    await new Promise((r) => setTimeout(r, 400));
    const fresh = await connectAgent(server, b, { retries: 20 });
    const results = {};
    for (const name of ["publish to A's mail subject", 'write a claim', 'purge a stream']) results[name] = await attempt(fresh, OPS[name]);
    console.log(`MUTATED config, B: ${JSON.stringify(results)}`);
    for (const [name, result] of Object.entries(results)) assert.equal(result.ok, true, `with the protection removed B should succeed at: ${name} (${result.refusal})`);
    await fresh.nc.close().catch(() => {});
  } finally { await conn.a.nc.close().catch(() => {}); await conn.b.nc.close().catch(() => {}); await server.stop(); }
});

test('(3) revoking an agent drops its open connection and refuses the key afterwards', async () => {
  const { server, a, conn } = await fixture();
  try {
    const dropped = new Promise((resolve) => (async () => { for await (const status of conn.a.nc.status()) if (status.type === 'disconnect' || status.type === 'error') resolve(status); })());
    const closed = conn.a.nc.closed();
    assert.equal(conn.a.nc.isClosed(), false);
    await server.store.revoke({ repo: REPO, agent: 'agentA' });
    const event = await Promise.race([dropped, new Promise((r) => setTimeout(() => r('STILL CONNECTED'), 3000))]);
    console.log(`revoke -> client saw: ${JSON.stringify(event)}; closed(): ${String(await Promise.race([closed, new Promise((r) => setTimeout(() => r('open'), 1500))]))}`);
    assert.notEqual(event, 'STILL CONNECTED', 'revoked agent kept its connection');
    const retry = await connectAgent(server, a).then(() => 'RECONNECTED', (error) => error.message);
    console.log(`revoked key reconnect: ${retry}`);
    assert.notEqual(retry, 'RECONNECTED');
    assert.equal(loadAgentUsers(server.home).some((entry) => entry.agent === 'agentA'), false);
  } finally { await conn.a.nc.close().catch(() => {}); await conn.b.nc.close().catch(() => {}); await server.stop(); }
});

test('(3b) control: without the reload nothing drops, so (3) measures revoke and not a coincidence', async () => {
  const { server, conn } = await fixture();
  try {
    const noReload = new CredStore({ home: server.home, serverPid: 2 ** 22 - 1 });
    await assert.rejects(noReload.revoke({ repo: REPO, agent: 'agentA' }), /ESRCH|kill/i, 'a store that cannot signal the server must say so');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(conn.a.nc.isClosed(), false);
    await attempt(conn.a, (nc) => nc.flush());
    assert.equal((await attempt(conn.a, (nc) => nc.jetstream({ timeout: 1500 }).publish(ORCH_LAYOUT.mailSubject(REPO, 'boss'), enc.encode('still works'))).then((r) => r.ok)), true,
      'the server was never reloaded, so A\'s old grant must still be live');
  } finally { await conn.a.nc.close().catch(() => {}); await conn.b.nc.close().catch(() => {}); await server.stop(); }
});

test('(4) rotation yields a working new credential and the old one is refused', async () => {
  const { server, a, conn } = await fixture();
  try {
    const next = await server.store.rotate({ repo: REPO, agent: 'agentA' });
    assert.notEqual(next.seed, a.seed);
    assert.equal(next.inboxPrefix, a.inboxPrefix, 'rotation keeps the identity and inbox');
    await new Promise((r) => setTimeout(r, 400));
    const fresh = await connectAgent(server, next, { retries: 20 });
    const works = await attempt(fresh, (nc) => nc.jetstream({ timeout: 2000 }).publish(ORCH_LAYOUT.mailSubject(REPO, 'boss'), enc.encode('after rotate')));
    console.log(`new credential: ${JSON.stringify(works)}`);
    assert.equal(works.ok, true, works.refusal);
    const old = await connectAgent(server, a).then(() => 'OLD KEY STILL WORKS', (error) => error.message);
    console.log(`old credential: ${old}`);
    assert.notEqual(old, 'OLD KEY STILL WORKS');
    assert.match(old, /authorization|violation|closed|refus/i);
    await fresh.nc.close().catch(() => {});
  } finally { await conn.a.nc.close().catch(() => {}); await conn.b.nc.close().catch(() => {}); await server.stop(); }
});

// ---- secrecy against a sibling of the same OS user -------------------------------------------------

function scan(needles, { pids }) {
  const hits = [];
  for (const pid of pids) {
    for (const file of ['environ', 'cmdline']) {
      let body = '';
      try { body = readFileSync(`/proc/${pid}/${file}`, 'latin1'); } catch { continue; }
      for (const [label, needle] of Object.entries(needles)) if (body.includes(needle)) hits.push(`/proc/${pid}/${file} contains ${label}`);
    }
  }
  return hits;
}

async function scanTree(dir, needles) {
  const hits = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    const body = await readFile(path, 'latin1').catch(() => '');
    for (const [label, needle] of Object.entries(needles)) if (body.includes(needle)) hits.push(`${path} contains ${label}`);
  }
  return hits;
}

const FETCH = `import { fetchAgentSecrets } from ${JSON.stringify(new URL('../../topology/lib/agent-creds.mjs', import.meta.url).href)};
try { const s = await fetchAgentSecrets(process.env); process.stdout.write('GOT ' + Object.keys(s).join(',') + '\\n'); setTimeout(() => process.exit(0), 20000); }
catch (e) { process.stdout.write('REFUSED ' + e.message + '\\n'); process.exit(0); }`;

function spawnReader(sock, { env = {} } = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', FETCH], { env: { PATH: process.env.PATH, AO_CREDS_SOCK: sock, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const line = new Promise((resolve) => { let buf = ''; child.stdout.on('data', (c) => { buf += c; if (buf.includes('\n')) resolve(buf.trim()); }); child.on('exit', () => resolve(buf.trim() || 'NO OUTPUT')); });
  return { child, line };
}

test('(2) sibling agent B cannot recover A\'s secret from environ, ps, the agent dir, the launch script or A\'s holder socket', async () => {
  const server = await startServer();
  const agentDir = await mkdtemp(join(os.tmpdir(), 'ao-agentdir-'));
  const readers = [];
  try {
    const token = `tok-${'a1b2c3d4'.repeat(4)}`;
    const { issued, holder } = await server.store.provision({ repo: REPO, agent: 'agentA', role: 'worker', mailTo: ['boss'], extra: { token } });
    const needles = { 'A seed': issued.seed, 'A reply token': token };
    // A's pane: a process that is the root of A's tree; its descendant (the reader) is "ao-topology reply".
    const aPane = spawn('bash', ['-c', `exec node --input-type=module -e ${JSON.stringify('setTimeout(()=>{},30000)')}`], { stdio: 'ignore' });
    await holder.attach(aPane.pid);
    // The launcher exactly as launch.mjs now builds it: socket path only.
    const script = launcherScript({ agent: { id: 'agentA', role: 'worker', cwd: agentDir }, candidate: { cli: 'claude' }, argv: ['true'], env: { AO_AGENT_ID: 'agentA', AO_CREDS_SOCK: holder.sock } });
    await writeFile(join(agentDir, 'launch-0.sh'), script, { mode: 0o700 });

    // A's own descendant (node, a child of A's pane process) gets the secrets.
    const mine = await new Promise((resolve) => {
      const tree = spawn('bash', ['-c', 'node --input-type=module -e "$FETCH_SRC"; sleep 20'], { env: { PATH: process.env.PATH, FETCH_SRC: FETCH, AO_CREDS_SOCK: holder.sock }, stdio: ['ignore', 'pipe', 'inherit'] });
      readers.push(tree);
      let buf = ''; tree.stdout.on('data', (c) => { buf += c; if (buf.includes('\n')) resolve(buf.trim()); }); tree.on('exit', () => resolve(buf.trim() || 'NO OUTPUT'));
      holder.attach(tree.pid);
    });
    console.log(`A (descendant of its pane process): ${mine}`);
    assert.match(mine, /^GOT /, 'the owning process tree must be able to get its own secret');
    await holder.attach(aPane.pid);

    // B: same OS user, knows the socket path (it can read A's launch script), is not in A's tree.
    const b = spawnReader(holder.sock);
    readers.push(b.child);
    const refused = await b.line;
    console.log(`B asking A's holder: ${refused}`);
    assert.match(refused, /^REFUSED .*not the owner/, 'B must be refused by the holder');

    const pids = [aPane.pid, holder.pid, b.child.pid];
    const leaks = [...scan(needles, { pids }), ...await scanTree(agentDir, needles)];
    const ps = await new Promise((resolve) => { const p = spawn('ps', ['-eo', 'pid,args', '-ww']); let out = ''; p.stdout.on('data', (c) => { out += c; }); p.on('close', () => resolve(out)); });
    for (const [label, needle] of Object.entries(needles)) if (ps.includes(needle)) leaks.push(`ps args contain ${label}`);
    console.log(`leak scan over environ/cmdline of [A pane, holder, B], ps -eo args, agent dir: ${JSON.stringify(leaks)}`);
    assert.deepEqual(leaks, []);

    // The scanner can find a leak: spawn a process with the seed in env (the old design) and the same scan flags it.
    const leaky = spawn('sleep', ['30'], { env: { ...process.env, AO_AGENT_TOKEN: token }, stdio: 'ignore' });
    readers.push(leaky);
    assert.deepEqual(scan(needles, { pids: [leaky.pid] }), [`/proc/${leaky.pid}/environ contains A reply token`], 'control: the scan must flag an env leak');
    await writeFile(join(agentDir, 'leaky.sh'), `export AO_AGENT_TOKEN=${token}\n`);
    assert.equal((await scanTree(agentDir, needles)).length, 1, 'control: the dir scan must flag a script leak');

    readers.push(aPane);
    await holder.revoke();
  } finally { for (const child of readers) child.kill('SIGKILL'); await rm(agentDir, { recursive: true, force: true }); await server.stop(); }
});

test('(2b) mutation: a holder that skips the ancestry check hands B the secret, so (2) can fail', async () => {
  const server = await startServer();
  try {
    const { issued, holder } = await server.store.provision({ repo: REPO, agent: 'agentA', role: 'worker', extra: { token: 'tok-x' } });
    // "Protection removed" = attach the root to B's own pid, i.e. B IS in the tree the holder trusts.
    const b = spawnReader(holder.sock);
    await holder.attach(b.child.pid);
    const got = await b.line;
    console.log(`B inside the trusted tree: ${got}`);
    assert.match(got, /^GOT /, 'with B inside the tree the holder answers; test (2) therefore depends on the ancestry check');
    b.child.kill('SIGKILL');
    assert.ok(issued.seed);
    await holder.revoke();
  } finally { await server.stop(); }
});

test('end to end: an agent transport built from the holder reads its own mail and cannot create layout', async () => {
  const server = await startServer();
  try {
    const { issued, holder } = await server.store.provision({ repo: REPO, agent: 'agentA', role: 'worker', mailTo: ['boss'], extra: { token: 'tok-e2e' } });
    const script = `import { openNatsTransport } from ${JSON.stringify(new URL('../../topology/lib/orch-transport.mjs', import.meta.url).href)};
const t = await openNatsTransport({ servers: ${JSON.stringify(server.url)}, env: { ...process.env } });
const mail = await t.pullMail({ repo: ${JSON.stringify(REPO)}, agent: 'agentA', timeoutMs: 2000 });
process.stdout.write('MAIL ' + (mail ? mail.body : 'none') + '\\n'); await mail?.ack(); await t.close(); process.exit(0);`;
    await server.js.publish(ORCH_LAYOUT.mailSubject(REPO, 'agentA'), enc.encode('hello A'));
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH, HOME: server.home, AO_CREDS_SOCK: holder.sock, AO_TRANSPORT: 'nats' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await holder.attach(child.pid);
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
    await new Promise((resolve) => child.on('exit', resolve));
    console.log(`agent transport: ${out.trim()} ${err.trim().slice(0, 300)}`);
    assert.match(out, /MAIL hello A/);
    assert.ok(issued.inboxPrefix.startsWith('_INBOX.agentA_'));
    await holder.revoke();
  } finally { await server.stop(); }
});

test('permissions name only the agent\'s own durables and never reach $SYS or stream administration', () => {
  const p = agentPermissions({ repo: REPO, agent: 'agentA', role: 'worker', mailTo: ['boss'], inboxPrefix: '_INBOX.agentA_x' });
  const all = [...p.publish.allow, ...p.subscribe.allow];
  assert.ok(all.every((s) => !/agentB/.test(s)));
  assert.ok(p.publish.allow.includes(ORCH_LAYOUT.mailSubject(REPO, 'boss')));
  assert.ok(!p.publish.allow.includes(ORCH_LAYOUT.mailSubject(REPO, 'agentA')));
  assert.ok(p.publish.deny.includes('$JS.API.STREAM.PURGE.>'));
  assert.ok(!p.publish.allow.some((s) => s.includes(ORCH_LAYOUT.claimsBucket) && s.startsWith('$KV')), 'a worker writes no claim');
  assert.ok(isDescendant(process.pid, process.pid) && !isDescendant(process.pid, 999999));
});
