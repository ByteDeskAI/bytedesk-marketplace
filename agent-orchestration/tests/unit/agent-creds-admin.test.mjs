// TM-310 round 2: the host/admin secret is on no disk and in no agent-readable env or command line, and an
// agent that asks the admin socket is refused. The mutation unregisters the agent's tree and shows it would get the seed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { REPO, startServer } from '../helpers/agent-creds-fixture.mjs';
import { fetchAdminSecrets, startHolder } from '../../topology/lib/agent-creds.mjs';

const lib = (name) => JSON.stringify(new URL(`../../topology/lib/${name}`, import.meta.url).href);

async function treeHits(dir, needle) {
  const hits = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if ((await readFile(path, 'latin1').catch(() => '')).includes(needle)) hits.push(path);
  }
  return hits;
}

function procHits(pids, needle) {
  const hits = [];
  for (const pid of pids) for (const file of ['environ', 'cmdline']) {
    try { if (readFileSync(`/proc/${pid}/${file}`, 'latin1').includes(needle)) hits.push(`/proc/${pid}/${file}`); } catch { /* gone */ }
  }
  return hits;
}

/** A child inside the agent's tree (holder attached to it) that asks the admin socket, then tries a no-credential transport. */
async function agentAsksAdmin(server, holder) {
  const source = `
import { fetchAdminSecrets, startHolder } from ${lib('agent-creds.mjs')};
import { openNatsTransport } from ${lib('orch-transport.mjs')};
await new Promise((resolve) => process.stdin.once('data', resolve));
const out = {};
try { const s = await fetchAdminSecrets(${JSON.stringify(server.state.adminSock)}); out.socket = 'GOT ' + Object.keys(s).join(','); } catch (e) { out.socket = 'REFUSED ' + e.message; }
try { const t = await openNatsTransport({ env: process.env, name: 'attacker' }); out.transport = 'OPENED'; await t.close(); } catch (e) { out.transport = 'REFUSED ' + e.message.slice(0, 160); }
console.log('RESULT ' + JSON.stringify(out)); process.exit(0);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH, HOME: server.home, AO_NATS_HOME: server.home, AO_NATS_SERVER: server.hostEnv.AO_NATS_SERVER,
    AO_NATS_AUTOSTART: '1', AGENT_ORCHESTRATION_SERVICES: '0', AO_TRANSPORT: 'nats' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  await holder.attach(child.pid);
  await new Promise((r) => setTimeout(r, 300)); // the holder writes roots.json asynchronously
  child.stdin.write('go\n');
  await new Promise((resolve) => child.on('exit', resolve));
  return JSON.parse(stdout.split('\n').find((l) => l.startsWith('RESULT ')).slice(7));
}

test('no admin secret on disk or in agent-readable env/cmdline; the admin socket refuses an agent', { timeout: 120000 }, async () => {
  const server = await startServer();
  const { holder } = await server.store.provision({ repo: REPO, agent: 'agentB', role: 'worker', mailTo: ['boss'], extra: { token: 'tok-B' } });
  try {
    // The operator (this process, outside every agent tree) can get the host identity...
    const { seed } = await fetchAdminSecrets(server.state.adminSock);
    assert.match(seed, /^SU/);
    // ...and it is nowhere an agent could read it.
    const state = readFileSync(join(server.home, 'state.json'), 'utf8');
    console.log(`state.json: ${state}`);
    assert.doesNotMatch(state, /"pass"|"user"|password/);
    const pids = [server.child.pid, server.state.adminPid, holder.pid];
    const ps = await new Promise((resolve) => { const p = spawn('ps', ['-eo', 'pid,args', '-ww']); let o = ''; p.stdout.on('data', (c) => { o += c; }); p.on('close', () => resolve(o)); });
    const leaks = [...await treeHits(server.home, seed), ...procHits(pids, seed), ...(ps.includes(seed) ? ['ps args'] : [])];
    console.log(`admin-seed leak scan (home dir files, environ+cmdline of server/admin holder/agent holder, ps args): ${JSON.stringify(leaks)}`);
    assert.deepEqual(leaks, []);
    // Control: the scan finds the seed when it IS planted.
    await writeFile(join(server.home, 'planted.txt'), seed);
    assert.equal((await treeHits(server.home, seed)).length, 1, 'control: the scan must flag a planted copy');
    await writeFile(join(server.home, 'planted.txt'), '');

    // Agent B, inside its own tree, asks the admin socket and tries to open a transport with no credential of its own.
    const refused = await agentAsksAdmin(server, holder);
    console.log(`agent B -> admin socket / transport: ${JSON.stringify(refused)}`);
    assert.match(refused.socket, /^REFUSED credential holder refused: not an operator process/);
    assert.match(refused.transport, /^REFUSED/);

    // Mutation: an agent whose holder never registered its tree (no home) is indistinguishable from the operator, and gets the seed.
    const unregistered = await startHolder({ token: 'tok-unregistered' });
    const handed = await agentAsksAdmin(server, unregistered);
    console.log(`MUTATED (agent tree not registered) -> ${JSON.stringify(handed)}`);
    assert.match(handed.socket, /^GOT seed/, 'without registration the admin socket cannot tell the agent from the operator, so the refusal above depends on it');
    await unregistered.revoke().catch(() => {});
  } finally { await holder.revoke().catch(() => {}); await server.stop(); }
});
