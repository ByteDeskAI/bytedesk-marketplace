// TM-316: a same-uid process that rewrites nats-server.conf and SIGHUPs the server is detected and undone.
// A real child process does the editing. The mutation run starts the admin holder with the watcher effectively
// disabled (AO_TAMPER_INTERVAL_MS = 1 h) and shows the same attack stays in force, so the repair is the watcher's doing.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { REPO, enc, nats, startServer } from '../helpers/agent-creds-fixture.mjs';
import { readTamperEvents, sha256 } from '../../topology/lib/nats-tamper.mjs';
import { requestSocket } from '../../topology/lib/agent-creds.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CLI = new URL('../../topology/cli.mjs', import.meta.url).pathname;

/** What a malicious same-uid agent does: a child process adds a user with ">" permissions to the config and SIGHUPs the server. */
async function attack(server, attackerPub) {
  const source = `
import { readFileSync, writeFileSync } from 'node:fs';
const [conf, pid, pub] = process.argv.slice(1);
const text = readFileSync(conf, 'utf8');
writeFileSync(conf, text.replace('users = [ ', 'users = [ { nkey: ' + pub + ', permissions: { publish: { allow: [">"] }, subscribe: { allow: [">"] } } },\\n      '));
process.kill(Number(pid), 'SIGHUP');
console.log('edited ' + conf + ' and sent SIGHUP to ' + pid);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, server.conf, String(server.child.pid), attackerPub], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  await new Promise((resolve) => child.on('exit', resolve));
  return out.trim();
}

/** Is the broad user usable? It must connect AND see a subject only an admin-level user could. */
async function broadUserWorks(server, attacker) {
  let nc;
  try {
    nc = await nats.connect({ servers: server.url, authenticator: nats.nkeyAuthenticator(enc.encode(attacker.seed)), maxReconnectAttempts: 0, timeout: 2000 });
  } catch (error) { return { works: false, why: `connect refused: ${error.message}` }; }
  try {
    const sub = nc.subscribe('>');
    await nc.flush();
    server.admin.publish('orch.tamper-probe', enc.encode('x'));
    await server.admin.flush();
    const got = await Promise.race([(async () => { for await (const m of sub) return m.subject; })(), sleep(1000).then(() => null)]);
    return { works: got === 'orch.tamper-probe', why: got ? `received ${got}` : 'connected, saw nothing' };
  } finally { await nc.close().catch(() => {}); }
}

async function withServer(intervalMs, body) {
  process.env.AO_TAMPER_INTERVAL_MS = String(intervalMs);
  const server = await startServer();
  try { await sleep(Math.min(1500, 2 * intervalMs) + 400); return await body(server); } finally { await server.stop(); }
}

test('mutation: with the watcher off, the broad user stays usable, and the next issue catches the edit', { timeout: 120000 }, async () => {
  await withServer(3_600_000, async (server) => {
    const attacker = (await import('nats')).nkeys.createUser();
    const pub = attacker.getPublicKey();
    const seed = new TextDecoder().decode(attacker.getSeed());
    const original = readFileSync(server.conf, 'utf8');
    console.log(`MUTATION attack: ${await attack(server, pub)}`);
    await sleep(2500);
    const after = await broadUserWorks(server, { seed });
    console.log(`MUTATION (watcher off) broad user after 2.5 s: ${JSON.stringify(after)}; conf sha ${sha256(original).slice(0, 12)} -> ${sha256(readFileSync(server.conf, 'utf8')).slice(0, 12)}`);
    assert.equal(after.works, true, 'the attack must work when nothing watches, or the repair below proves nothing');
    assert.deepEqual(readTamperEvents(server.home), [], 'no watcher, no event');
    // Issue-time check: ao rewrites the config for the new agent; the admin holder compares what it finds first.
    await server.store.issue({ repo: REPO, agent: 'agentZ', role: 'worker' });
    const events = readTamperEvents(server.home);
    console.log(`MUTATION issue-time event: ${JSON.stringify(events)}`);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'conf-changed-before-update');
    assert.deepEqual(events[0].usersAdded, [pub]);
    assert.doesNotMatch(readFileSync(server.conf, 'utf8'), new RegExp(pub), 'the rewritten config no longer names the attacker');
  });
});

test('watcher: a rewritten config and SIGHUP is undone, journaled, and shown by doctor; a server restart is a notice', { timeout: 180000 }, async (t) => {
  await withServer(300, async (server) => {
    const attacker = (await import('nats')).nkeys.createUser();
    const pub = attacker.getPublicKey();
    const seed = new TextDecoder().decode(attacker.getSeed());
    const original = readFileSync(server.conf, 'utf8');
    const status0 = await requestSocket(server.state.adminSock, { op: 'tamper' });
    console.log(`holder before attack: ${JSON.stringify(status0)}`);
    assert.equal(status0.watching, true);
    assert.equal(status0.expectedSha, sha256(original), 'the holder expects exactly the file ao wrote');
    console.log(`attack: ${await attack(server, pub)}`);
    const tamperedSha = sha256(readFileSync(server.conf, 'utf8'));
    assert.notEqual(tamperedSha, sha256(original), 'control: the edit landed on disk');
    // Repair window: interval 300 ms + reload; wait for it.
    let events = [];
    for (let i = 0; i < 40 && events.length === 0; i += 1) { await sleep(100); events = readTamperEvents(server.home); }
    await sleep(600); // let the server finish reloading
    const result = await broadUserWorks(server, { seed });
    const conf = readFileSync(server.conf, 'utf8');
    console.log(`after repair window: broad user ${JSON.stringify(result)}; conf sha now ${sha256(conf).slice(0, 12)} (expected ${sha256(original).slice(0, 12)}, tampered ${tamperedSha.slice(0, 12)})`);
    console.log(`nats.tamper event: ${JSON.stringify(events[0])}`);
    assert.equal(result.works, false, 'the broad user must not be usable after the repair window');
    assert.equal(conf, original, 'the config is back to the holder\'s copy');
    assert.equal(events[0].type, 'nats.tamper');
    assert.equal(events[0].kind, 'conf-changed');
    assert.deepEqual(events[0].usersAdded, [pub]);
    assert.equal(events[0].before.sha256, sha256(original));
    assert.equal(events[0].after.sha256, tamperedSha);
    assert.equal(events[0].repaired, true);
    assert.equal(events[0].reloaded, server.child.pid, 'the server was told to reload');
    assert.doesNotMatch(JSON.stringify(events), /SU[A-Z2-7]{50,}/, 'no seed in the journal');
    assert.equal((statSync0(server.conf).mode & 0o777), 0o600);

    // doctor, through the real CLI.
    const doctor = await runDoctor(server);
    const finding = doctor.problems.find((p) => p.code === 'NATS_CONFIG_TAMPERED');
    console.log(`doctor finding: ${JSON.stringify(finding)}; holder: ${JSON.stringify(doctor.tamper.holder)}`);
    assert.ok(finding, 'doctor reports the tamper');
    assert.match(finding.message, new RegExp(pub));

    // Server identity: replace the server process; a different pid is a notice, not an alarm.
    const oldPid = server.child.pid;
    server.child.kill('SIGKILL');
    await new Promise((resolve) => server.child.on('exit', resolve));
    const next = spawn(server.hostEnv.AO_NATS_SERVER, ['-c', server.conf], { stdio: 'ignore' });
    server.child = next;
    t.after(() => next.kill('SIGKILL')); // stop() kills only the server it started, not this replacement
    // The watcher may sample between the kill and the new start (pid null), so the chain is old -> (null) -> new.
    let swaps = [];
    for (let i = 0; i < 60 && !swaps.some((e) => e.after.pid === next.pid); i += 1) { await sleep(150); swaps = readTamperEvents(server.home).filter((e) => e.kind === 'server-pid-changed'); }
    console.log(`server swap events: ${JSON.stringify(swaps.map((e) => [e.before.pid, e.after.pid, e.severity]))} (old pid ${oldPid}, new pid ${next.pid})`);
    assert.ok(swaps.length >= 1 && swaps.every((e) => e.severity === 'notice'));
    assert.equal(swaps[0].before.pid, oldPid);
    assert.equal(swaps.at(-1).after.pid, next.pid);
    const afterSwap = await runDoctor(server);
    assert.equal(afterSwap.tamper.events.filter((e) => e.kind === 'server-pid-changed').length, 0, 'a restart is not listed as tamper');
  });
});

import { statSync as statSync0 } from 'node:fs';
async function runDoctor(server) {
  // doctor probes every provider CLI on PATH (`claude --version`...); the suite's guard (TM-290) forbids real ones, so give it a PATH holding only tmux.
  const bin = join(server.home, 'bin');
  mkdirSync(bin, { recursive: true });
  try { symlinkSync(execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim(), join(bin, 'tmux')); } catch { /* no tmux: doctor reports it */ }
  const child = spawn(process.execPath, [CLI, 'doctor', '--json'], { env: { PATH: bin, HOME: server.home, XDG_CONFIG_HOME: join(server.home, '.config'), AO_NATS_HOME: server.home,
    AGENT_ORCHESTRATION_SERVICES: '0', AO_NATS_AUTOSTART: '0', TMUX: '', TMUX_TMPDIR: server.home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  await new Promise((resolve) => child.on('exit', resolve));
  return JSON.parse(out);
}
